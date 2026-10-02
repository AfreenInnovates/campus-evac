import { createHash } from "node:crypto";
import { PollyClient, SynthesizeSpeechCommand } from "@aws-sdk/client-polly";
import { NextResponse } from "next/server";
import { composeGuidance, parseContext } from "@/app/simulation/narration-context";
import { toSsml, VOICE_ENGINE, VOICE_ID } from "@/app/simulation/narration-script";

export const runtime = "nodejs";

/**
 * Real-time narration: the client posts the drill state, this composes the line for that
 * exact situation and returns it spoken.
 *
 * The request carries state, never text, so the composer on this side produces the same
 * sentence the client already captioned and nothing arbitrary can be pushed through Polly.
 *
 * Situations repeat constantly — the same room at the same smoke level, the same objective
 * with the same air bucket — so a composed line is hashed and its audio kept. In practice a
 * whole drill settles into a few dozen distinct sentences and most requests never reach AWS.
 */

const MAX_CACHE = 200;
const cache = new Map<string, Buffer>();

let polly: PollyClient | null = null;
const client = () => (polly ??= new PollyClient({ region: process.env.POLLY_REGION ?? process.env.AWS_REGION ?? "us-east-1" }));

function remember(key: string, audio: Buffer) {
  cache.delete(key);
  cache.set(key, audio);
  // plain LRU: the oldest key is the first one the Map yields
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request" }, { status: 400 });
  }

  const context = parseContext(body);
  if (!context) return NextResponse.json({ error: "Unrecognised drill state" }, { status: 400 });

  const text = composeGuidance(context);
  const key = createHash("sha256").update(`${VOICE_ID}|${VOICE_ENGINE}|${text}`).digest("hex");

  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached); // touch, so hot lines stay resident
    return audioResponse(cached, text, "cache");
  }

  try {
    const response = await client().send(
      new SynthesizeSpeechCommand({
        VoiceId: VOICE_ID,
        Engine: VOICE_ENGINE,
        Text: toSsml(text),
        TextType: "ssml",
        OutputFormat: "mp3",
        SampleRate: "24000",
      }),
    );
    if (!response.AudioStream) throw new Error("no audio");
    const audio = Buffer.from(await response.AudioStream.transformToByteArray());
    remember(key, audio);
    return audioResponse(audio, text, "polly");
  } catch (error) {
    console.error("Polly narration failed", error);
    // the caller already has the caption and a pre-rendered clip to fall back on
    return NextResponse.json({ error: "Speech unavailable", text }, { status: 503 });
  }
}

function audioResponse(audio: Buffer, text: string, source: "polly" | "cache") {
  return new NextResponse(new Uint8Array(audio), {
    headers: {
      "content-type": "audio/mpeg",
      "content-length": String(audio.byteLength),
      "cache-control": "private, max-age=3600",
      "x-narration-source": source,
      // the client captions from its own composer; this is here so the two can be diffed
      "x-narration-text": encodeURIComponent(text),
    },
  });
}
