import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Agent, McpClient, type MessageData } from "@strands-agents/sdk";
import { OpenAIModel } from "@strands-agents/sdk/models/openai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The simulated Alexa+ behind the Echo page: a Strands agent running NVIDIA Nemotron on
 * Nebius Token Factory that answers by calling the CampusEvac MCP server over Streamable HTTP, the same way Alexa+ calls a
 * brand's MCP server. It connects to this app's own /api/mcp, so what it can do is exactly
 * what the MCP server offers, nothing added on the side.
 *
 * Stateless: the page sends the conversation so far with each turn and gets it back with the
 * new turn added.
 */

const BASE_URL = process.env.NEBIUS_BASE_URL ?? "https://api.tokenfactory.nebius.com/v1";
/** Nemotron 3 Super: good at choosing and chaining tools. Token Factory speaks the OpenAI chat protocol. */
const MODEL_ID = process.env.ECHO_MODEL_ID?.trim() || "nvidia/nemotron-3-super-120b-a12b";

const SYSTEM_PROMPT = [
  "You are Alexa, answering through the CampusEvac skill: it knows one campus building, its rooms, exits and smoke, and can run simulated fire drills with AI people in it.",
  "Everything you say is spoken aloud by a smart speaker. Answer in one to four short sentences, plain words, no lists, no markdown, no emoji.",
  "Always use the CampusEvac tools for anything about the building, routes, smoke, drills or people's needs; never invent rooms, exits or results.",
  "Most tools return a `speech` sentence: say it, keeping its directions exactly (compass directions and doorway signs, never left or right).",
  "If someone says there is a real fire now, give them the way out from find_way_out first, then tell them to call the emergency number once they are safe. Drills are simulations, say so if it is unclear.",
  "Never say you will do something (start, run, check, compare, save) without calling the tool for it in the same turn. If you say it, do it now.",
  "Drills are simulations and need no confirmation: run them as soon as they are asked for.",
  "Before register_occupant, confirm once what you will save (first name, usual room, needs), because it is health information.",
  "What-if questions mean a drill: \"what happens if a fire starts in X\", \"what if there's a fire in X\", \"run a drill\", \"test the building\" -> call start_drill with that room. Do not answer them from the building description.",
  "A drill takes up to four minutes. After start_drill or compare_fixes, say it has started and that the light will turn yellow when it is done.",
  "\"How did the drill go?\" -> get_drill_result (no id needed: it reads the most recent drill).",
  "\"Would X help?\" or \"what if we added X\" about a building change (a ramp, flashing alarms, text alerts, low-level signs, a spoken alarm, occupancy sensors) -> call compare_fixes straight away with the matching fixes, even if you do not remember a drill: it reruns the most recent drill on the server, and tells you if there is none (then start_drill with those fixes).",
].join("\n");

/** Keep the conversation short: the last turns are what matter on a voice device. */
const MAX_HISTORY = 24;
const MAX_HISTORY_BYTES = 120_000;

/* the same coarse per-address budget as the other model routes */
const WINDOW_MS = 60_000;
const BUDGET = 30;
const spend = new Map<string, { start: number; count: number }>();
function allowed(address: string) {
  const now = Date.now();
  const entry = spend.get(address);
  if (!entry || now - entry.start > WINDOW_MS) {
    spend.set(address, { start: now, count: 1 });
    return true;
  }
  entry.count++;
  return entry.count <= BUDGET;
}

/** The newest turns, cut so the history still starts with something the person said. */
function trim(history: MessageData[]) {
  let kept = history.slice(-MAX_HISTORY);
  const startsWithWords = (m: MessageData) => m.role === "user" && m.content.some((block) => "text" in block);
  while (kept.length && !startsWithWords(kept[0])) kept = kept.slice(1);
  return kept;
}

interface ToolCall {
  name: string;
  input: unknown;
  ok: boolean;
}

/** What the agent did this turn, read off the messages it added: each MCP tool it called and whether it worked. */
function traceOf(added: MessageData[]) {
  const calls: ToolCall[] = [];
  const byId = new Map<string, ToolCall>();
  let showOnScreen = false;
  let drillId: string | null = null;
  for (const message of added)
    for (const block of message.content) {
      if ("toolUse" in block) {
        const call = { name: block.toolUse.name, input: block.toolUse.input, ok: true };
        byId.set(block.toolUse.toolUseId, call);
        calls.push(call);
      }
      if ("toolResult" in block) {
        const call = byId.get(block.toolResult.toolUseId);
        if (call) call.ok = block.toolResult.status !== "error";
        const text = JSON.stringify(block.toolResult.content);
        // the result's JSON arrives either as text (quotes escaped) or as a JSON block (plain)
        if (/\\?"show_on_screen\\?":\s*true/.test(text)) showOnScreen = true;
        const id = text.match(/\\?"drill_id\\?":\s*\\?"(drill-[a-z0-9-]+)/)?.[1];
        if (id && (call?.name === "start_drill" || call?.name === "compare_fixes")) drillId = id;
      }
    }
  return { calls, showOnScreen, drillId };
}

const textOf = (message: MessageData) =>
  message.content
    .map((block) => ("text" in block ? block.text : ""))
    .join(" ")
    // some models think aloud in tags before answering; only the answer is spoken
    .replace(/<thinking>[\s\S]*?<\/thinking>/g, "")
    .trim();

export async function POST(request: Request) {
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowed(address)) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: { text?: unknown; history?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request" }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text.trim().slice(0, 600) : "";
  if (!text) return NextResponse.json({ error: "Say something first" }, { status: 400 });
  const raw = Array.isArray(body.history) ? (body.history as MessageData[]) : [];
  if (JSON.stringify(raw).length > MAX_HISTORY_BYTES) return NextResponse.json({ error: "Conversation too long, start a new one" }, { status: 413 });
  const history = trim(raw);

  // this app's own MCP server, called over HTTP like any other MCP client would
  const key = process.env.MCP_DRILL_KEY?.trim();
  const mcp = new McpClient({
    applicationName: "campusevac-echo",
    transport: new StreamableHTTPClientTransport(new URL("/api/mcp", request.url), {
      requestInit: key ? { headers: { Authorization: `Bearer ${key}` } } : undefined,
    }),
    // a voice turn cannot wait minutes on a task; start_drill plus get_drill_result does the same job
    toolFilters: { rejected: ["run_drill"] },
  });

  const apiKey = process.env.NEBIUS_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "NEBIUS_API_KEY is not set" }, { status: 503 });

  try {
    const agent = new Agent({
      model: new OpenAIModel({
        api: "chat",
        modelId: MODEL_ID,
        apiKey,
        clientConfig: { baseURL: BASE_URL },
        maxTokens: 1024,
        temperature: 0.3,
        // a voice turn has to come back in seconds: answer and call tools without a long chain of thought first
        params: { chat_template_kwargs: { enable_thinking: false } },
      }),
      systemPrompt: SYSTEM_PROMPT,
      tools: [mcp],
      messages: history,
      printer: false,
    });
    const result = await agent.invoke(text);
    const all = agent.messages.map((message) => message.toJSON());
    const trace = traceOf(all.slice(history.length));
    return NextResponse.json({
      reply: textOf(result.lastMessage.toJSON()) || "Sorry, I don't have an answer for that.",
      history: all,
      tools: trace.calls,
      show_on_screen: trace.showOnScreen,
      drill_id: trace.drillId,
      model: MODEL_ID,
    });
  } catch (error) {
    const err = error as Error;
    console.error("Echo agent failed", err.name, err.message);
    // say which part failed, so the page can tell a model outage from a bug
    return NextResponse.json({ error: `${err.name}: ${err.message}`.slice(0, 300) }, { status: 503 });
  } finally {
    await mcp.disconnect().catch(() => {});
  }
}
