"use client";

/**
 * Narration playback.
 *
 * Every line is rendered ahead of time by `npm run voice` (Amazon Polly, Matthew neural)
 * and served from `public/voice`, so a drill makes no AWS calls and waits on no network
 * round trip to speak. Clips are fetched once, decoded into AudioBuffers and played on
 * the AudioContext the beeps already use.
 *
 * `speakNarration` keeps its old contract — say this, call back when the voice stops —
 * because the briefing sequencer and the movement gate are both built on it. What changed
 * is that the callback now fires on the real end of audio instead of a words-per-second
 * guess, and every player hears the same voice.
 */

import { getAudioContext } from "./audio";
import { composeGuidance, type DrillContext } from "./narration-context";
import { CLIP_GAP, EVACUEE_BRIEFING, objectiveCue, roomCue, type ClipId, type Cue } from "./narration-script";

export {
  ALL_CLIP_IDS,
  BRIEFING_CLIP_IDS,
  EVACUEE_BRIEFING,
  ROOM_NARRATION,
  briefingCue,
  objectiveCue,
  roomCue,
  type Cue,
} from "./narration-script";

/** A cue that can also be spoken live for the exact situation it was built from. */
export type PlayableCue = Cue & { live?: DrillContext };

type ClipEntry = { file: string; ms: number };
type Manifest = { voice: string; engine: string; clips: Record<ClipId, ClipEntry> };

const MANIFEST_URL = "/voice/manifest.json";
/** Reading pace used only when there is no audio to time against. */
const WORDS_PER_SECOND = 2.5;

let manifest: Manifest | null = null;
let manifestRequest: Promise<Manifest | null> | null = null;
const decoded = new Map<ClipId, AudioBuffer>();
const decoding = new Map<ClipId, Promise<AudioBuffer | null>>();

/** Bumped by every new line and by stopNarration, so late async work can tell it is stale. */
let generation = 0;
let playing: AudioBufferSourceNode[] = [];
let fallbackTimer: number | undefined;

/* -- loading ------------------------------------------------------------- */

function loadManifest(): Promise<Manifest | null> {
  manifestRequest ??= fetch(MANIFEST_URL)
    .then((response) => (response.ok ? (response.json() as Promise<Manifest>) : null))
    .then((value) => (manifest = value))
    .catch(() => null);
  return manifestRequest;
}

async function loadClip(id: ClipId): Promise<AudioBuffer | null> {
  const cached = decoded.get(id);
  if (cached) return cached;
  const inFlight = decoding.get(id);
  if (inFlight) return inFlight;

  const request = (async () => {
    const context = getAudioContext();
    const entry = (manifest ?? (await loadManifest()))?.clips[id];
    if (!context || !entry) return null;
    try {
      const response = await fetch(`/voice/${entry.file}`);
      if (!response.ok) return null;
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      decoded.set(id, buffer);
      return buffer;
    } catch {
      return null; // a missing or undecodable clip falls back to a silent caption
    } finally {
      decoding.delete(id);
    }
  })();

  decoding.set(id, request);
  return request;
}

/**
 * Warms the cache in the background. The whole script is about 840KB, so the simplest
 * correct thing is to pull all of it once when the drill mounts; by the time the briefing
 * ends every later line is already decoded and starts instantly.
 */
export function primeNarration(ids: readonly ClipId[]) {
  if (typeof window === "undefined") return;
  void loadManifest().then(() => {
    for (const id of ids) void loadClip(id);
  });
}

/* -- live narration ------------------------------------------------------- */

/**
 * Situational lines are composed from the live drill state and spoken by Polly on demand,
 * so what the narrator says reflects where the evacuee actually is, how much air is left
 * and whether the route has failed. The pre-rendered script stays underneath as the
 * guaranteed-instant fallback: if the network is slow or the route is down, the generic
 * line still plays rather than nothing.
 *
 * Audio is cached by the composed sentence, so revisiting the same situation is free and
 * silent on the wire.
 */

const liveAudio = new Map<string, AudioBuffer>();
const liveRequests = new Map<string, Promise<AudioBuffer | null>>();

function requestLive(context: DrillContext): Promise<AudioBuffer | null> {
  const key = composeGuidance(context);
  const cached = liveAudio.get(key);
  if (cached) return Promise.resolve(cached);
  const inFlight = liveRequests.get(key);
  if (inFlight) return inFlight;

  const request = (async () => {
    const audioContext = getAudioContext();
    if (!audioContext) return null;
    try {
      const response = await fetch("/api/narration", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(context),
      });
      if (!response.ok) return null;
      const buffer = await audioContext.decodeAudioData(await response.arrayBuffer());
      liveAudio.set(key, buffer);
      return buffer;
    } catch {
      return null;
    } finally {
      liveRequests.delete(key);
    }
  })();

  liveRequests.set(key, request);
  return request;
}

/** Warms a line the drill is about to need, so the voice starts the moment it is cued. */
export function primeLive(context: DrillContext) {
  if (typeof window === "undefined" || !readVoiceEnabled()) return;
  void requestLive(context);
}

/**
 * The line for a situation: live audio when it can be had, the matching pre-rendered clip
 * when it cannot, and in both cases the same caption text.
 */
export function situationCue(context: DrillContext): PlayableCue {
  const fallback =
    context.event.kind === "room"
      ? roomCue(context.event.sector)
      : objectiveCue(context.event.objective, context.progress);
  return { ids: fallback?.ids ?? [], text: composeGuidance(context), live: context };
}

/* -- briefing text -------------------------------------------------------- */

export type BriefingProvider = "bedrock" | "authored";
export type BriefingResult = { lines: string[]; provider: BriefingProvider };

/**
 * Keep Bedrock available for a future provider handoff, but use the authored script by
 * default. Only the authored lines have rendered audio, so a Bedrock briefing plays as
 * timed captions — fine before the drill starts, never used for in-game directions.
 */
export const useBedrock = false;

export async function loadBedrockBriefing(signal?: AbortSignal): Promise<BriefingResult> {
  const fallback: BriefingResult = { lines: EVACUEE_BRIEFING, provider: "authored" };
  if (!useBedrock) return fallback;
  try {
    const response = await fetch("/api/narration", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "evacuee" }),
      signal,
    });
    if (!response.ok) return fallback;
    const body = (await response.json()) as { lines?: unknown; provider?: unknown };
    return Array.isArray(body.lines) && body.lines.every((line) => typeof line === "string") && body.lines.length > 0
      ? { lines: body.lines as string[], provider: body.provider === "bedrock" ? "bedrock" : "authored" }
      : fallback;
  } catch {
    return fallback;
  }
}

/* -- preference ---------------------------------------------------------- */

const VOICE_KEY = "campusevac:voice";

/** Captions always show; this only controls whether they are also read aloud. */
export function readVoiceEnabled() {
  try {
    return localStorage.getItem(VOICE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function writeVoiceEnabled(enabled: boolean) {
  try {
    localStorage.setItem(VOICE_KEY, enabled ? "on" : "off");
  } catch {
    /* preference lasts for this page only */
  }
  if (!enabled) stopNarration();
}

/* -- playback ------------------------------------------------------------ */

function clearPlayback() {
  window.clearTimeout(fallbackTimer);
  fallbackTimer = undefined;
  for (const source of playing) {
    source.onended = null;
    try {
      source.stop();
    } catch {
      /* already finished */
    }
    source.disconnect();
  }
  playing = [];
}

/** Silent but correctly paced, so captions still clear on time with the voice switched off. */
function speakSilently(cue: Cue, onEnd: () => void) {
  const known = cue.ids.reduce((total, id) => total + (manifest?.clips[id]?.ms ?? 0), 0);
  const estimate = Math.max(2200, (cue.text.split(/\s+/).length / WORDS_PER_SECOND) * 1000 + 1200);
  const ms = known > 0 ? known + cue.ids.length * CLIP_GAP * 1000 : estimate;
  fallbackTimer = window.setTimeout(onEnd, ms);
}

/**
 * Speaks a cue and calls `onEnd` once, whatever happens: audio finished, audio was never
 * available, or the player has voice switched off. Starting a new cue cancels the last.
 */
export function speakNarration(cue: PlayableCue, onEnd: () => void) {
  if (typeof window === "undefined") {
    onEnd();
    return;
  }

  clearPlayback();
  const token = ++generation;
  const current = () => generation === token;
  const finish = () => {
    if (current()) onEnd();
  };

  void (async () => {
    const silently = async () => {
      await loadManifest();
      if (current()) speakSilently(cue, finish);
    };

    const context = getAudioContext();
    if (!context || !readVoiceEnabled() || (!cue.ids.length && !cue.live)) return silently();

    // A suspended context has a frozen clock, so anything scheduled against it is not
    // dropped — it waits, then fires the moment some later gesture resumes the context,
    // which sounds like the narrator talking at random. Wait for the resume to settle
    // rather than reading `state` straight after asking for it: on a cold page the flip is
    // not synchronous, and checking too early would silence the first line of the briefing.
    if (context.state !== "running") await context.resume().catch(() => undefined);
    if (!current()) return;
    if (context.state !== "running") return silently();

    // Live first: it is the line written for this exact situation. The rendered clip is the
    // same guidance without the conditions, so falling back to it is a downgrade, not a break.
    const live = cue.live ? await requestLive(cue.live) : null;
    if (!current()) return;

    const buffers = live
      ? [live]
      : ((await Promise.all(cue.ids.map(loadClip))).filter((buffer): buffer is AudioBuffer => buffer !== null));
    if (!current()) return;
    if (!buffers.length || buffers.length !== (live ? 1 : cue.ids.length)) return silently();

    // Schedule the whole cue on the audio clock in one pass: the gap between a "done" line
    // and its "next" instruction is then sample-accurate rather than a setTimeout.
    let at = context.currentTime + 0.04;
    buffers.forEach((buffer, index) => {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.start(at);
      at += buffer.duration + (index < buffers.length - 1 ? CLIP_GAP : 0);
      if (index === buffers.length - 1) source.onended = finish;
      playing.push(source);
    });
  })();
}

export function stopNarration() {
  if (typeof window === "undefined") return;
  generation += 1;
  clearPlayback();
}
