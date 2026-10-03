"use client";

import { create } from "zustand";

/**
 * The Crowd Lab's voice: one line at a time, warden announcements first.
 *
 * Lines are spoken by Amazon Polly through /api/speak. If that is unavailable (no AWS
 * credentials, offline), the browser's own speech engine reads them instead, so the lab
 * always talks.
 */

export type Speaker = "warden" | "narrator";

const KEY = "campusevac:crowd-voice";

// starts on for everyone, server and browser alike, so the first render matches; the saved choice is read after
export const useVoice = create<{ on: boolean; source: "polly" | "browser" | null }>(() => ({ on: true, source: null }));

/** Apply the visitor's saved choice. Called once the page is running in the browser. */
export function loadVoiceChoice() {
  try {
    if (localStorage.getItem(KEY) === "off") useVoice.setState({ on: false });
  } catch {
    /* keep the default */
  }
}

export function setVoiceOn(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* lasts for this page */
  }
  useVoice.setState({ on });
  if (!on) stopSpeaking();
}

interface Line {
  text: string;
  speaker: Speaker;
}

const queue: Line[] = [];
let playing: HTMLAudioElement | null = null;
let busy = false;
/** bumped by every stop, so a line that was already on its way never starts after it */
let generation = 0;
/** follows the replay speed, so the voice keeps up with a 2x or 4x replay */
let rate = 1;

export function stopSpeaking() {
  generation++;
  queue.length = 0;
  playing?.pause();
  playing = null;
  busy = false;
  if (typeof window !== "undefined") window.speechSynthesis?.cancel();
}

export function setVoiceRate(next: number) {
  rate = next;
  if (playing) playing.playbackRate = rate;
}

export function pauseVoice() {
  playing?.pause();
  if (typeof window !== "undefined") window.speechSynthesis?.pause();
}

export function resumeVoice() {
  void playing?.play().catch(() => {});
  if (typeof window !== "undefined") window.speechSynthesis?.resume();
}

/**
 * Queue a line. Narrator lines are dropped rather than allowed to pile up behind the action;
 * an announcement always gets through.
 */
export function speak(text: string, speaker: Speaker = "narrator") {
  if (!useVoice.getState().on || !text.trim()) return;
  if (speaker === "narrator") {
    if (queue.length >= 2) return;
  } else {
    // a new announcement replaces any narrator chatter still waiting
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i].speaker === "narrator") queue.splice(i, 1);
  }
  // at speed, the narrator would fall behind the picture: keep only what is current
  if (rate > 1 && speaker === "narrator" && (busy || queue.length)) return;
  queue.push({ text, speaker });
  void drain();
}

async function drain() {
  if (busy) return;
  const line = queue.shift();
  if (!line) return;
  busy = true;
  const mine = generation;
  try {
    await (useVoice.getState().source === "browser" ? speakInBrowser(line) : speakWithPolly(line));
  } catch {
    useVoice.setState({ source: "browser" });
    await speakInBrowser(line).catch(() => {});
  } finally {
    if (mine === generation) {
      busy = false;
      void drain();
    }
  }
}

async function speakWithPolly(line: Line) {
  const response = await fetch("/api/speak", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: line.text, voice: line.speaker }),
  });
  if (!response.ok) throw new Error(String(response.status));
  useVoice.setState({ source: "polly" });
  const mine = generation;
  const url = URL.createObjectURL(await response.blob());
  try {
    await new Promise<void>((resolve, reject) => {
      if (mine !== generation) return resolve();
      const audio = new Audio(url);
      audio.playbackRate = rate;
      playing = audio;
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error("playback"));
      audio.play().catch(reject);
    });
  } finally {
    URL.revokeObjectURL(url);
    playing = null;
  }
}

/**
 * Utterances must stay referenced until they finish: Chrome garbage-collects one that only
 * the speech engine holds and stops talking mid-sentence. Long lines are also split into
 * sentences, because Chrome silently drops speech that runs past ~15 seconds.
 */
const speaking = new Set<SpeechSynthesisUtterance>();

async function speakInBrowser(line: Line) {
  const synth = window.speechSynthesis;
  if (!synth) return;
  const sentences = line.text.match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [line.text];
  const mine = generation;
  for (const sentence of sentences) {
    if (!useVoice.getState().on || mine !== generation) return;
    await new Promise<void>((resolve) => {
      const utterance = new SpeechSynthesisUtterance(sentence);
      const english = synth.getVoices().filter((v) => v.lang.startsWith("en"));
      utterance.voice = english[line.speaker === "warden" ? 0 : Math.min(1, english.length - 1)] ?? null;
      utterance.rate = Math.min(2.5, (line.speaker === "warden" ? 1 : 1.05) * rate);
      utterance.pitch = line.speaker === "warden" ? 0.9 : 1.05;
      const done = () => {
        speaking.delete(utterance);
        resolve();
      };
      utterance.onend = done;
      utterance.onerror = done;
      speaking.add(utterance);
      synth.speak(utterance);
    });
  }
}
