import { NextResponse } from "next/server";
import { MODELS, SYSTEM, type CrowdTask } from "@/app/simulation/crowd/prompts";

export const runtime = "nodejs";

/**
 * Every model call the Crowd Lab makes goes through here, so the Nebius key never reaches
 * the browser and each task can only run its own fixed system prompt on its own model.
 *
 * Nebius Token Factory speaks the OpenAI chat-completions protocol.
 */

const BASE_URL = process.env.NEBIUS_BASE_URL ?? "https://api.tokenfactory.nebius.com/v1";
const TASKS: CrowdTask[] = ["evacuee", "warden-see", "warden-think", "debrief"];

/* a coarse per-address budget, so a public demo cannot be used to burn the credits */
const WINDOW_MS = 60_000;
const BUDGET = 240;
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

/** Models sometimes wrap JSON in prose or a code fence; take the outermost object. */
function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const key = process.env.NEBIUS_API_KEY;
  if (!key) return NextResponse.json({ error: "NEBIUS_API_KEY is not set" }, { status: 503 });

  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowed(address)) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: { task?: string; input?: string; image?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request" }, { status: 400 });
  }
  const task = body.task as CrowdTask;
  if (!TASKS.includes(task)) return NextResponse.json({ error: "Unknown task" }, { status: 400 });
  const input = typeof body.input === "string" ? body.input.slice(0, 24_000) : "";
  const image = typeof body.image === "string" && body.image.startsWith("data:image/") ? body.image : null;
  if (task === "warden-see" && !image) return NextResponse.json({ error: "Missing image" }, { status: 400 });
  if (image && image.length > 3_000_000) return NextResponse.json({ error: "Image too large" }, { status: 413 });

  const spec = MODELS[task];
  const user =
    task === "warden-see"
      ? [
          { type: "text", text: input || "Report what the CCTV frame shows." },
          { type: "image_url", image_url: { url: image } },
        ]
      : input;

  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: spec.model,
        max_tokens: spec.maxTokens,
        temperature: spec.temperature,
        messages: [
          { role: "system", content: SYSTEM[task] },
          { role: "user", content: user },
        ],
        ...spec.extra,
      }),
      signal: AbortSignal.timeout(spec.timeoutMs),
    });
  } catch (error) {
    return NextResponse.json({ error: `Model call failed: ${(error as Error).message}` }, { status: 502 });
  }
  const ms = Date.now() - started;
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    return NextResponse.json({ error: `Nebius ${response.status}: ${detail}` }, { status: 502 });
  }
  const payload = (await response.json()) as {
    choices?: { message?: { content?: string; reasoning_content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = payload.choices?.[0]?.message?.content?.trim() ?? "";
  const reasoning = payload.choices?.[0]?.message?.reasoning_content?.trim() ?? "";
  if (!text)
    return NextResponse.json(
      { error: reasoning ? "The model ran out of tokens while still thinking" : "Empty answer", input: payload.usage?.prompt_tokens ?? 0, output: payload.usage?.completion_tokens ?? 0 },
      { status: 502 },
    );
  return NextResponse.json({
    reasoning: reasoning.slice(0, 2400),
    model: spec.model,
    ms,
    input: payload.usage?.prompt_tokens ?? 0,
    output: payload.usage?.completion_tokens ?? 0,
    text,
    json: spec.json ? extractJson(text) : null,
  });
}
