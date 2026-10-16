import { MODELS, SYSTEM, type CrowdTask } from "@/app/simulation/crowd/prompts";

/**
 * One Crowd Lab model call on Nebius Token Factory: a task's fixed system prompt on its own
 * model. Shared by /api/crowd (calls from the browser) and drills run on the server.
 *
 * Nebius Token Factory speaks the OpenAI chat-completions protocol.
 */

const BASE_URL = process.env.NEBIUS_BASE_URL ?? "https://api.tokenfactory.nebius.com/v1";
export const TASKS: CrowdTask[] = ["evacuee", "warden-see", "warden-think", "debrief", "advise"];

export interface TaskReply {
  text?: string;
  reasoning?: string;
  json?: unknown;
  model?: string;
  ms?: number;
  input?: number;
  output?: number;
  error?: string;
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

/** Run one task; `status` is the HTTP status /api/crowd answers with. */
export async function runTask(task: CrowdTask, input: string, image: string | null): Promise<{ status: number; body: TaskReply }> {
  const key = process.env.NEBIUS_API_KEY;
  if (!key) return { status: 503, body: { error: "NEBIUS_API_KEY is not set" } };
  const spec = MODELS[task];
  const user =
    task === "warden-see"
      ? [
          { type: "text", text: input || "Report what the CCTV frame shows." },
          { type: "image_url", image_url: { url: image } },
        ]
      : input;

  const messages = [
    { role: "system", content: SYSTEM[task] },
    { role: "user", content: user },
  ];
  const started = Date.now();
  let first = await complete(key, { model: spec.model, max_tokens: spec.maxTokens, temperature: spec.temperature, messages, ...spec.extra }, spec.timeoutMs);
  if ("error" in first) return { status: 502, body: { error: first.error } };
  let tokensIn = first.input;
  let tokensOut = first.output;
  // a reasoning model that thought through its whole budget gets one quick second try, answering straight away
  if (!first.text && first.reasoning && spec.retryWithoutThinking) {
    const second = await complete(
      key,
      { model: spec.model, max_tokens: spec.retryWithoutThinking, temperature: spec.temperature, messages, chat_template_kwargs: { enable_thinking: false } },
      spec.timeoutMs,
    );
    if (!("error" in second)) {
      tokensIn += second.input;
      tokensOut += second.output;
      first = { ...second, reasoning: first.reasoning };
    }
  }
  const { text, reasoning } = first;
  if (!text) return { status: 502, body: { error: reasoning ? "The model ran out of tokens while still thinking" : "Empty answer", input: tokensIn, output: tokensOut } };
  return {
    status: 200,
    body: {
      reasoning: reasoning.slice(0, 2400),
      model: spec.model,
      ms: Date.now() - started,
      input: tokensIn,
      output: tokensOut,
      text,
      json: spec.json ? extractJson(text) : null,
    },
  };
}

/** One chat completion on Token Factory: the answer, any reasoning, and the tokens it used. */
async function complete(key: string, body: Record<string, unknown>, timeoutMs: number) {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return { error: `Model call failed: ${(error as Error).message}` };
  }
  if (!response.ok) return { error: `Nebius ${response.status}: ${(await response.text()).slice(0, 300)}` };
  const payload = (await response.json()) as {
    choices?: { message?: { content?: string; reasoning_content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  // some models think inline in <think> tags; keep that as reasoning and answer with what follows
  const raw = payload.choices?.[0]?.message?.content ?? "";
  const inline = raw.match(/<think>([\s\S]*?)(<\/think>|$)/);
  return {
    text: raw.replace(/<think>[\s\S]*?(<\/think>|$)/, "").trim(),
    reasoning: (payload.choices?.[0]?.message?.reasoning_content ?? inline?.[1] ?? "").trim(),
    input: payload.usage?.prompt_tokens ?? 0,
    output: payload.usage?.completion_tokens ?? 0,
  };
}
