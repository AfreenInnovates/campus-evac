/**
 * Renders every narration line to MP3 with Amazon Polly.
 *
 *   npm run voice            render anything that changed
 *   npm run voice -- --force re-render everything
 *
 * Run it on a developer machine, not in CI. The MP3s are committed, so a deploy needs
 * no AWS credentials and nothing calls Polly at runtime: by the time a drill starts the
 * audio is already a static asset on the CDN.
 *
 * Node 24 runs this file directly via type stripping, so the script can import the same
 * script module the browser uses and the two can never drift apart.
 */

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PollyClient, SynthesizeSpeechCommand } from "@aws-sdk/client-polly";
import { CLIPS, toSsml, VOICE_ENGINE, VOICE_ID } from "../app/simulation/narration-script.ts";

const OUT_DIR = join(process.cwd(), "public", "voice");
const MANIFEST = join(OUT_DIR, "manifest.json");
const REGION = process.env.POLLY_REGION ?? "us-east-1";
const SAMPLE_RATE = "24000";
const force = process.argv.includes("--force");

type Entry = { file: string; ms: number };
type Manifest = { voice: string; engine: string; generated: string; clips: Record<string, Entry> };

/* -- mp3 duration -------------------------------------------------------
   Polly returns audio with no duration attached, and we need it so captions stay
   correctly timed when a player has voice switched off and nothing is decoded.
   Walking the MPEG frame headers is exact and needs no dependency. */

const BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

function durationMs(buffer: Buffer): number {
  let offset = 0;
  // skip an ID3v2 tag if Polly wrote one
  if (buffer.length > 10 && buffer.toString("ascii", 0, 3) === "ID3") {
    offset = 10 + ((buffer[6] << 21) | (buffer[7] << 14) | (buffer[8] << 7) | buffer[9]);
  }
  let seconds = 0;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff || (buffer[offset + 1] & 0xe0) !== 0xe0) {
      offset += 1; // not a frame header, resynchronise
      continue;
    }
    const versionBits = (buffer[offset + 1] >> 3) & 0x03;
    const layerBits = (buffer[offset + 1] >> 1) & 0x03;
    const bitrateIndex = (buffer[offset + 2] >> 4) & 0x0f;
    const rateIndex = (buffer[offset + 2] >> 2) & 0x03;
    const padding = (buffer[offset + 2] >> 1) & 0x01;
    const rates = RATES[versionBits];
    if (layerBits !== 0x01 || !rates || rateIndex === 3 || bitrateIndex === 0 || bitrateIndex === 15) {
      offset += 1;
      continue;
    }
    const isVersion1 = versionBits === 3;
    const bitrate = (isVersion1 ? BITRATES_V1 : BITRATES_V2)[bitrateIndex] * 1000;
    const sampleRate = rates[rateIndex];
    const samples = isVersion1 ? 1152 : 576;
    const length = Math.floor((samples / 8) * (bitrate / sampleRate)) + padding;
    if (length <= 0) break;
    seconds += samples / sampleRate;
    offset += length;
  }
  return Math.round(seconds * 1000);
}

/* -- render -------------------------------------------------------------- */

const polly = new PollyClient({ region: REGION });

async function synthesize(ssml: string): Promise<Buffer> {
  const response = await polly.send(
    new SynthesizeSpeechCommand({
      VoiceId: VOICE_ID,
      Engine: VOICE_ENGINE,
      Text: ssml,
      TextType: "ssml",
      OutputFormat: "mp3",
      SampleRate: SAMPLE_RATE,
    }),
  );
  if (!response.AudioStream) throw new Error("Polly returned no audio");
  return Buffer.from(await response.AudioStream.transformToByteArray());
}

const readManifest = async (): Promise<Manifest | null> => {
  try {
    return JSON.parse(await readFile(MANIFEST, "utf8")) as Manifest;
  } catch {
    return null;
  }
};

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const previous = force ? null : await readManifest();
  const existing = new Set(await readdir(OUT_DIR).catch(() => []));
  const clips: Record<string, Entry> = {};
  let rendered = 0;
  let reused = 0;
  let characters = 0;

  for (const clip of CLIPS) {
    const ssml = toSsml(clip.text);
    // the hash covers voice and engine too, so switching voice re-renders everything
    const hash = createHash("sha256").update(`${VOICE_ID}|${VOICE_ENGINE}|${SAMPLE_RATE}|${ssml}`).digest("hex").slice(0, 10);
    const file = `${clip.id}.${hash}.mp3`;
    const cached = previous?.clips[clip.id];

    if (cached?.file === file && existing.has(file)) {
      clips[clip.id] = cached;
      reused += 1;
      continue;
    }

    const audio = await synthesize(ssml);
    await writeFile(join(OUT_DIR, file), audio);
    clips[clip.id] = { file, ms: durationMs(audio) };
    characters += ssml.length;
    rendered += 1;
    console.log(`  rendered  ${clip.id.padEnd(22)} ${(audio.length / 1024).toFixed(0).padStart(3)}KB  ${(clips[clip.id].ms / 1000).toFixed(1)}s`);
  }

  const manifest: Manifest = { voice: VOICE_ID, engine: VOICE_ENGINE, generated: new Date().toISOString(), clips };
  await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

  // drop MP3s left behind by edited or deleted lines so the folder never grows stale
  const keep = new Set(Object.values(clips).map((entry) => entry.file));
  let pruned = 0;
  for (const name of existing) {
    if (name.endsWith(".mp3") && !keep.has(name)) {
      await unlink(join(OUT_DIR, name));
      pruned += 1;
    }
  }

  console.log(
    `\n${VOICE_ID} / ${VOICE_ENGINE} / ${REGION}` +
      `\n${rendered} rendered, ${reused} unchanged, ${pruned} pruned` +
      `\n${characters} characters billed this run`,
  );
}

main().catch((error) => {
  console.error(`\nvoice build failed: ${error instanceof Error ? error.message : error}`);
  if (String(error).includes("expired") || String(error).includes("credentials")) {
    console.error("run `aws login` and try again");
  }
  process.exitCode = 1;
});
