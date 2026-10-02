"use client";

import { useEffect, useRef, useState } from "react";
import { lab, MAX_RUN_SECONDS, useLab, type LabEvent, type LogEntry } from "./engine";
import { setVoiceOn, speak, stopSpeaking, useVoice } from "./voice";

/**
 * The simple view: the drill explains itself.
 *
 * A narrator says what is happening in one plain line (and out loud), the warden's
 * announcements appear as a PA banner and are spoken in a PA voice, and a scoreboard counts
 * who is safe. Everything else lives behind "Details".
 */

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const say = (n: number) => NUMBER_WORDS[n] ?? String(n);

/** The narrator's line for an event, or null when it is not worth interrupting for. */
function line(event: LabEvent): string | null {
  switch (event.type) {
    case "start":
      return `Fire in the ${event.room}. ${say(event.people)} people are inside, and none of them has a map. Watch the warden try to get them out.`;
    case "out":
      if (event.safe === 1) return `${event.name} is the first one out.`;
      if (event.safe === event.people) return "Everyone is out.";
      return event.safe % 3 === 0 ? `${say(event.safe)} of ${say(event.people)} people are safe.` : null;
    case "down":
      return `${event.name} collapsed in the ${event.room}.`;
    case "shelter":
      return `${event.name} is trapped, and is sheltering in the ${event.room}.`;
    case "end":
      return `The drill is over. ${say(event.survived)} of ${say(event.people)} people survived.`;
    default:
      return null;
  }
}

/** "To #3, #9" becomes "Numbers three and nine", so the spoken PA addresses people naturally. */
function announcement(event: Extract<LabEvent, { type: "announce" }>) {
  if (!event.people?.length) return event.text;
  const names = event.people.map((id) => lab.agents.find((a) => a.id === id)?.name ?? `number ${id}`);
  const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${who}: ${event.text}`;
}

export interface Shown {
  caption: string | null;
  pa: { text: string; at: number } | null;
}

/**
 * Watches the drill log and turns new events into speech, a caption and the PA banner.
 * Returns what to show; renders nothing itself.
 */
export function useStory(): Shown {
  const log = useLab((s) => s.snap?.log);
  const seen = useRef(new WeakSet<LogEntry>());
  const run = useRef(-1);
  const [shown, setShown] = useState<Shown>({ caption: null, pa: null });

  useEffect(() => {
    // a new drill (or the same replay watched again) starts the story over
    if (!log || run.current !== lab.runId) {
      seen.current = new WeakSet();
      run.current = lab.runId;
      if (!log) return;
    }
    // the log is newest-first; walk the unseen entries oldest-first
    const fresh: LogEntry[] = [];
    for (const entry of log) {
      if (seen.current.has(entry)) break;
      fresh.push(entry);
    }
    if (!fresh.length) return;
    for (const entry of fresh) seen.current.add(entry);
    let caption: string | null = null;
    let pa: Shown["pa"] = null;
    for (const entry of fresh.reverse()) {
      const event = entry.event;
      if (!event) continue;
      if (event.type === "announce") {
        const spoken = announcement(event);
        pa = { text: spoken, at: Date.now() };
        speak(spoken, "warden");
      } else {
        const text = line(event);
        if (text) {
          caption = text;
          speak(text, "narrator");
        }
      }
    }
    if (caption || pa)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- derived from a stream of new log entries
      setShown((current) => ({ caption: caption ?? current.caption, pa: pa ?? current.pa }));
  }, [log]);

  useEffect(() => () => stopSpeaking(), []);
  return shown;
}

/* ------------------------------------------------------------------ pieces */

/** One plain sentence about what is happening right now. */
export function Caption({ text }: { text: string | null }) {
  const busy = useLab((s) => s.snap?.wardenBusy ?? false);
  const running = useLab((s) => s.snap?.running ?? false);
  const content = busy && running ? "The warden is looking at the security camera…" : text;
  if (!content) return null;
  return (
    <div key={content} className="hud-rise mx-auto max-w-[min(40rem,calc(100vw-1.5rem))] bg-night/85 px-4 py-2 text-center text-[13px] leading-snug text-paper sm:text-[14px]">
      {content}
    </div>
  );
}

/** The warden's latest announcement, big, for a few seconds. */
export function PABanner({ pa }: { pa: Shown["pa"] }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!pa) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [pa]);
  if (!pa || now - pa.at > 8000) return null;
  return (
    <div key={pa.at} className="hud-rise mx-auto w-[min(36rem,calc(100vw-1.5rem))] border-[3px] border-ink bg-sun px-4 py-2.5 text-ink shadow-[5px_5px_0_var(--ink)]">
      <div className="text-[10px] font-black uppercase tracking-[0.2em]">📢 Warden announcement</div>
      <div className="mt-0.5 text-[15px] font-black leading-snug sm:text-[17px]">{pa.text}</div>
    </div>
  );
}

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

/** Who is safe, who is still inside, who is hurt. Nothing else. */
export function Scoreboard() {
  const t = useLab((s) => s.snap?.t ?? 0);
  const counts = useLab((s) => {
    const agents = s.snap?.agents ?? [];
    const safe = agents.filter((a) => a.status === "safe").length;
    const sheltering = agents.filter((a) => a.status === "inside" && a.sheltering).length;
    const hurt = agents.filter((a) => a.status === "down").length;
    return `${safe}|${agents.length - safe - sheltering - hurt}|${sheltering}|${hurt}`;
  });
  const [safe, inside, sheltering, hurt] = counts.split("|").map(Number);
  const chip = (label: string, value: number, color: string) => (
    <span className="flex items-baseline gap-1.5">
      <b className="font-mono text-[15px]" style={{ color }}>
        {value}
      </b>
      <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-paper/60">{label}</span>
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <span className="font-mono text-[12px] text-paper/70">
        {clock(t)}
        <span className="text-paper/35"> / {clock(MAX_RUN_SECONDS)}</span>
      </span>
      {chip("safe", safe, "var(--mint)")}
      {chip("inside", inside, "var(--paper)")}
      {sheltering > 0 && chip("sheltering", sheltering, "#38bdf8")}
      {chip("hurt", hurt, "var(--danger)")}
    </div>
  );
}

export function VoiceToggle({ className = "" }: { className?: string }) {
  const on = useVoice((s) => s.on);
  return (
    <button onClick={() => setVoiceOn(!on)} className={className} aria-pressed={on} title={on ? "Turn the voice off" : "Turn the voice on"}>
      {on ? "🔊 Voice" : "🔈 Muted"}
    </button>
  );
}
