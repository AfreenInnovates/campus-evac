import { createHash } from "node:crypto";
import { PollyClient, SynthesizeSpeechCommand } from "@aws-sdk/client-polly";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Speech for the Crowd Lab and the Echo page: the warden's PA announcements, the narrator's
 * progress lines and the assistant's answers, spoken by Amazon Polly.
 *
 * The warden's words come from a model, so this accepts text - but only a short line (a
 * longer one for the Echo page's assistant), from one of three fixed voices, under a
 * per-address budget. The same line is spoken often (the narrator repeats itself across
 * runs), so audio is cached by its hash.
 */

const VOICES = {
  // the PA: a firm, clear male voice
  warden: { VoiceId: "Matthew", rate: "100%" },
  // the narrator explaining what is happening
  narrator: { VoiceId: "Joanna", rate: "105%" },
  // the voice assistant on the Echo page, which reads out whole routes and drill results
  assistant: { VoiceId: "Joanna", rate: "100%" },
} as const;

const MAX_CHARS = 280;
/** A spoken route or drill result runs longer than a PA line; still well under Polly's limit. */
const MAX_ASSISTANT_CHARS = 1500;
const MAX_CACHE = 300;
const cache = new Map<string, Buffer>();

const WINDOW_MS = 60_000;
const BUDGET = 60;
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

let polly: PollyClient | null = null;
const client = () => (polly ??= new PollyClient({ region: process.env.POLLY_REGION ?? process.env.AWS_REGION ?? "ap-south-1" }));

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function POST(request: Request) {
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  let body: { text?: unknown; voice?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request" }, { status: 400 });
  }
  const voice = body.voice === "warden" ? "warden" : body.voice === "assistant" ? "assistant" : "narrator";
  const limit = voice === "assistant" ? MAX_ASSISTANT_CHARS : MAX_CHARS;
  const text = typeof body.text === "string" ? body.text.replace(/\s+/g, " ").trim().slice(0, limit) : "";
  if (!text) return NextResponse.json({ error: "Nothing to say" }, { status: 400 });

  const key = createHash("sha256").update(`${voice}|${text}`).digest("hex");
  const hit = cache.get(key);
  if (!hit && !allowed(address)) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  try {
    let audio = hit;
    if (!audio) {
      const { VoiceId, rate } = VOICES[voice];
      const result = await client().send(
        new SynthesizeSpeechCommand({
          Engine: "neural",
          OutputFormat: "mp3",
          TextType: "ssml",
          VoiceId,
          Text: `<speak><prosody rate="${rate}">${escape(text)}</prosody></speak>`,
        }),
      );
      audio = Buffer.from(await result.AudioStream!.transformToByteArray());
      cache.set(key, audio);
      if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
    }
    return new NextResponse(new Uint8Array(audio), {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=86400" },
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 503 });
  }
}
