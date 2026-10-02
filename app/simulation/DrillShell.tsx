"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type FormEvent, type ReactNode } from "react";
import Minimap from "./components/Minimap";
import TouchControls from "./components/TouchControls";
import { PortraitBlock } from "./components/PortraitBlock";
import { enterLandscape } from "./orientation";
import { useCoarsePointer } from "./useCoarsePointer";
import { setGraphicsQuality, useGraphicsQuality } from "./graphics";
import {
  CRITICAL_SCENARIO_OBJECTS,
  nextScenarioGuidance,
  roomById,
  scenarioObjectById,
  type ScenarioObjectId,
} from "./level";
import { playSignal } from "./audio";
import BriefingArtwork from "./components/BriefingArtwork";
import {
  ALL_CLIP_IDS,
  EVACUEE_BRIEFING,
  briefingCue,
  loadBedrockBriefing,
  primeLive,
  primeNarration,
  readVoiceEnabled,
  situationCue,
  speakNarration,
  stopNarration,
  writeVoiceEnabled,
} from "./narration";
import { bucketAir, bucketSmoke, type DrillContext, type DrillEvent } from "./narration-context";
import { runtime } from "./runtime";
import { resolveRoom, useSession } from "./session";
import { drillSummary, useSimulation, VIEWS, type ViewMode } from "./store";
import { RECONNECT_GRACE_MS, type EvidenceStatus, type RouteMessage } from "./net/types";

const DrillCanvas = dynamic(() => import("./DrillCanvas"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 grid place-items-center text-xs font-black uppercase tracking-[0.3em] text-paper/60">
      Loading the Science Block...
    </div>
  ),
});

const STEPS: ScenarioObjectId[] = [...CRITICAL_SCENARIO_OBJECTS, "main-exit"];
const placeName = (id: ScenarioObjectId) => roomById(scenarioObjectById(id).room).name.split(" / ").pop();

/* ------------------------------------------------------------------ pieces */

function Key({ children, light = false, small = false }: { children: ReactNode; light?: boolean; small?: boolean }) {
  const style: CSSProperties = {
    ...(light ? { borderColor: "var(--ink)", background: "var(--night)", color: "var(--paper)" } : null),
    ...(small ? { height: "1.2rem", minWidth: "1.2rem", fontSize: "0.58rem", padding: "0 0.25rem" } : null),
  };
  return (
    <kbd className="hud-key" style={style}>
      {children}
    </kbd>
  );
}

function Bar({ label, value, color, danger }: { label: string; value: number; color: string; danger?: boolean }) {
  const fill = danger ? "var(--danger)" : color;
  return (
    <div className="w-36">
      <div className="mb-1 flex items-center justify-between text-[10px] font-black uppercase tracking-[0.16em] text-paper/75">
        <span>{label}</span>
        <span className="font-mono" style={{ color: fill }}>
          {Math.round(value)}
        </span>
      </div>
      <div className="h-1.5 w-full bg-black/45">
        <div className="h-full transition-[width] duration-150" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: fill }} />
      </div>
    </div>
  );
}

function statusColor(status: EvidenceStatus) {
  return status === "VERIFIED"
    ? "var(--mint)"
    : status === "OBSERVED"
      ? "var(--sun)"
      : status === "STALE" || status === "EXPIRED"
        ? "var(--coral)"
        : "var(--violet)";
}

/** Brand and place. On a phone the brand row goes: the screen is too short to spend on it. */
function LocationHeader({ tag, compact = false }: { tag: string; compact?: boolean }) {
  const sector = useSimulation((state) => state.sector);
  const parts = roomById(sector).name.split(" / ");
  const block = parts.length > 1 ? parts[0] : "Campus";
  const place = parts[parts.length - 1];
  if (compact)
    return (
      <div className="inline-flex max-w-full items-center gap-2 bg-night/75 px-2 py-1 text-[9px] font-black uppercase tracking-[0.16em]">
        <span className="text-sun">{block}</span>
        <span className="text-paper/35">|</span>
        <span className="truncate text-paper">{place}</span>
      </div>
    );
  return (
    <div className="pointer-events-auto">
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center border-2 border-ink bg-coral text-[10px] font-black text-ink shadow-[2px_2px_0_var(--ink)]">CE</span>
        <span className="text-lg font-black tracking-[-0.04em] text-paper [text-shadow:2px_2px_0_var(--ink)]">CampusEvac</span>
        <span className="hidden border border-paper/30 bg-night/70 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.18em] text-paper/75 sm:inline">{tag}</span>
      </div>
      <div className="mt-1.5 inline-flex max-w-full items-center gap-2 bg-night/70 px-2 py-1 text-[10px] font-black uppercase tracking-[0.18em]">
        <span className="text-sun">{block}</span>
        <span className="text-paper/35">|</span>
        <span className="truncate text-paper">{place}</span>
      </div>
    </div>
  );
}

/**
 * One objective at a time: what to do next and where. The whole checklist is a Tab away on
 * a keyboard, or a tap on the card on a phone - where the card is also narrower and keeps
 * the instruction to two lines, since the narrator reads it out anyway.
 */
function ObjectivesPanel() {
  const progress = useSimulation((state) => state.scenarioProgress);
  const touch = useCoarsePointer();
  const [expanded, setExpanded] = useState(false);
  const guidance = nextScenarioGuidance(progress);
  const done = CRITICAL_SCENARIO_OBJECTS.filter((id) => progress[id]).length;
  const showAll = expanded;

  useEffect(() => {
    if (touch) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      event.preventDefault();
      setExpanded((value) => !value);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [touch]);

  const current = guidance.id === "complete" ? null : guidance;
  return (
    <section
      className={`hud-panel pointer-events-auto ${touch ? "w-[min(15rem,45vw)] p-2" : "w-[min(19.5rem,calc(100vw-1.5rem))] p-3"}`}
      aria-label="Objectives"
      onClick={touch ? () => setExpanded((value) => !value) : undefined}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-sun">{showAll ? "Objectives" : "Next step"}</h2>
        <div className="flex items-center gap-1" role="img" aria-label={`${done} of ${CRITICAL_SCENARIO_OBJECTS.length} done`}>
          {STEPS.map((id) => (
            <span key={id} className={`h-1.5 w-3 ${progress[id] ? "bg-mint" : guidance.id === id ? "bg-sun" : "bg-paper/20"}`} />
          ))}
        </div>
      </div>
      {!showAll && current && (
        <div key={current.id} className={`hud-rise ${touch ? "mt-1" : "mt-2"}`}>
          <div className={`${touch ? "text-[12px]" : "text-[14px]"} font-black leading-tight text-paper`}>
            {current.label}
            <span className="ml-2 text-[9px] font-bold uppercase tracking-wider text-paper/45">
              {roomById(current.room).name.split(" / ").pop()}
            </span>
          </div>
          {!touch && <p className="mt-1 text-[11px] leading-snug text-paper/75">{current.instruction}</p>}
        </div>
      )}
      <div className="mt-2 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.16em] text-paper/40">
        {touch ? (
          <>Tap for {showAll ? "less" : "directions"}</>
        ) : (
          <>
            <Key small>Tab</Key> {showAll ? "hide the list" : "all steps"}
          </>
        )}
      </div>
      <ol className={`mt-2 space-y-1.5 border-t border-paper/15 pt-2 ${showAll ? "" : "hidden"}`}>
        {STEPS.map((id) => {
          const complete = progress[id];
          const current = guidance.id === id;
          return (
            <li key={id} className="flex items-start gap-2 text-[12px] leading-snug">
              <span
                className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center border-2 text-[9px] font-black ${
                  complete ? "border-mint bg-mint text-ink" : current ? "border-sun text-sun" : "border-paper/30 text-transparent"
                }`}
                aria-hidden
              >
                {complete ? "✓" : current ? "›" : ""}
              </span>
              <div className="min-w-0">
                <div className={complete ? "text-paper/40 line-through decoration-paper/30" : current ? "font-bold text-paper" : "text-paper/70"}>
                  {scenarioObjectById(id).label}
                  <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wider text-paper/40">{placeName(id)}</span>
                </div>
                {current && <p className="mt-1 text-[11px] leading-snug text-sun">{guidance.instruction}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** A label, a number and a hairline bar, for tight spaces. */
function MiniBar({ label, value, color, danger }: { label: string; value: number; color: string; danger?: boolean }) {
  const fill = danger ? "var(--danger)" : color;
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center justify-between gap-2 text-[9px] font-black uppercase tracking-[0.14em] text-paper/70">
        <span>{label}</span>
        <span className="font-mono" style={{ color: fill }}>
          {Math.round(value)}
        </span>
      </div>
      <div className="mt-0.5 h-1 w-full bg-black/45">
        <div className="h-full" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: fill }} />
      </div>
    </div>
  );
}

function Vitals({ compact = false }: { compact?: boolean }) {
  const health = useSimulation((state) => state.health);
  const air = useSimulation((state) => state.air);
  if (compact)
    return (
      <div className="hud-panel flex w-[min(15rem,45vw)] gap-3 px-2 py-1.5" style={{ borderLeftColor: "var(--mint)" }}>
        <MiniBar label="Health" value={health} color="var(--mint)" danger={health < 35} />
        <MiniBar label="Air" value={air} color="#6fb8ff" danger={air < 35} />
      </div>
    );
  return (
    <div className="hud-panel flex flex-col gap-2 px-3 py-2.5" style={{ borderLeftColor: "var(--mint)" }}>
      <Bar label="Health" value={health} color="var(--mint)" danger={health < 35} />
      <Bar label="Air" value={air} color="#6fb8ff" danger={air < 35} />
    </div>
  );
}

/**
 * Everything the warden needs to know about the evacuee, in one card: where they are, how
 * they are doing, and what they are heading for. Replaces a paragraph of instructions and a
 * separate vitals block.
 */
function EvacueeStatus({ hint }: { hint?: string }) {
  const sector = useSimulation((state) => state.sector);
  const health = useSimulation((state) => state.health);
  const air = useSimulation((state) => state.air);
  const progress = useSimulation((state) => state.scenarioProgress);
  const next = nextScenarioGuidance(progress);
  const touch = useCoarsePointer();
  return (
    <div className={`hud-panel pointer-events-auto ${touch ? "w-[min(14rem,42vw)] px-2 py-1.5" : "w-[min(17rem,calc(100vw-1.5rem))] px-3 py-2.5"}`} style={{ borderLeftColor: "#38bdf8" }}>
      <div className="flex items-center justify-between gap-2 text-[9px] font-black uppercase tracking-[0.18em]">
        <span className="text-[#38bdf8]">Evacuee</span>
        <span className="truncate text-paper">{roomById(sector).name.split(" / ").pop()}</span>
      </div>
      <div className="mt-1.5 flex gap-3">
        <MiniBar label="Health" value={health} color="var(--mint)" danger={health < 35} />
        <MiniBar label="Air" value={air} color="#6fb8ff" danger={air < 35} />
      </div>
      {!touch && (
        <div className="mt-2 truncate text-[10px] text-paper/60">
          Heading for <b className="text-paper">{next.label}</b>
        </div>
      )}
      {hint && <div className="mt-1.5 border-t border-paper/10 pt-1.5 text-[10px] text-paper/50">{hint}</div>}
    </div>
  );
}

function PromptBar() {
  const prompt = useSimulation((state) => state.prompt);
  if (!prompt) return null;
  const action = prompt.match(/^Press E to (.+)$/);
  return (
    <div key={prompt} className="hud-rise flex max-w-[min(34rem,calc(100vw-2rem))] items-center gap-2 border-2 border-ink bg-paper px-3 py-2 text-[13px] font-bold text-ink shadow-[4px_4px_0_var(--ink)]">
      {action ? (
        <>
          Press <Key light>E</Key> to {action[1]}
        </>
      ) : (
        <>
          <span className="bg-coral px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest">Heads up</span>
          {prompt}
        </>
      )}
    </div>
  );
}

/** The key strip: there while the player is learning the controls, then out of the way. */
const CONTROLS_VISIBLE_MS = 25_000;

function ControlsHint() {
  const briefing = useSimulation((state) => state.briefingStatus);
  const resetSeq = useSimulation((state) => state.resetSeq);
  const [hiddenFor, setHiddenFor] = useState<number | null>(null);
  useEffect(() => {
    if (briefing !== "complete") return;
    const timer = window.setTimeout(() => setHiddenFor(resetSeq), CONTROLS_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [briefing, resetSeq]);
  const visible = briefing !== "complete" || hiddenFor !== resetSeq;
  const items: [string, string][] = [
    ["WASD", "move"],
    ["Shift", "sprint"],
    ["Space", "jump"],
    ["E", "interact"],
    ["V", "camera"],
    ["Tab", "steps"],
    ["Esc", "menu"],
  ];
  return (
    <div
      className="hud-fade flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-night/60 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-paper/70"
      style={{ opacity: visible ? 1 : 0 }}
      aria-hidden={!visible}
    >
      {items.map(([key, label]) => (
        <span key={key} className="flex items-center gap-1.5">
          <Key small>{key}</Key>
          {label}
        </span>
      ))}
    </div>
  );
}

/** A large, brief place name the first time the evacuee walks into somewhere new. */
function RoomTitle() {
  const [title, setTitle] = useState<{ id: number; place: string; block: string } | null>(null);
  useEffect(() => {
    let seq = 0;
    let timer: number | undefined;
    const unsubscribe = useSimulation.subscribe((state, previous) => {
      if (state.briefingStatus !== "complete" || state.sector === previous.sector) return;
      if (previous.explored[state.sector] || state.sector === "outside") return;
      const parts = roomById(state.sector).name.split(" / ");
      const id = ++seq;
      setTitle({ id, place: parts[parts.length - 1], block: parts.length > 1 ? parts[0] : "Campus" });
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setTitle((current) => (current?.id === id ? null : current)), 2900);
    });
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
    };
  }, []);
  if (!title) return null;
  return (
    <div key={title.id} className="room-title pointer-events-none absolute inset-x-0 top-[17%] z-10 flex flex-col items-center text-center" aria-hidden>
      <span className="text-[10px] font-black uppercase tracking-[0.4em] text-sun/90">{title.block}</span>
      <span className="mt-1 h-px w-40 bg-paper/40" />
      <span className="mt-2 text-2xl font-black uppercase text-paper [text-shadow:0_2px_18px_rgba(0,0,0,0.7)] sm:text-4xl">{title.place}</span>
      <span className="mt-2 h-px w-40 bg-paper/40" />
    </div>
  );
}

/** Air running out shows at the edges of the screen, not only in a number. */
function AirVignette() {
  const air = useSimulation((state) => state.air);
  const failed = useSimulation((state) => state.failed);
  const opacity = failed ? 0 : Math.max(0, Math.min(1, (60 - air) / 45));
  return (
    <div
      className={`air-vignette pointer-events-none absolute inset-0 z-[5] ${air < 25 && !failed ? "gasping" : ""}`}
      style={{ opacity }}
      aria-hidden
    />
  );
}

/** Spoken and captioned lines when a room is first entered or a step is completed. */
function NarrationCaption() {
  const mode = useSimulation((state) => state.mode.kind);
  const [caption, setCaption] = useState<{ id: number; text: string } | null>(null);

  useEffect(() => {
    if (mode === "warden") return;
    // ~840KB for the whole script: pull it once up front so no line ever waits on a fetch
    primeNarration(ALL_CLIP_IDS);
    let seq = 0;
    let timer: number | undefined;
    const say = (context: DrillContext) => {
      const id = ++seq;
      const cue = situationCue(context);
      window.clearTimeout(timer);
      // caption first: composed locally, so it lands the instant the event does and never
      // waits on the voice, which arrives a few hundred milliseconds later
      setCaption({ id, text: cue.text });
      speakNarration(cue, () => {
        timer = window.setTimeout(() => setCaption((current) => (current?.id === id ? null : current)), 1500);
      });
    };
    /** What the narrator can see right now, bucketed so repeated readings reuse one clip. */
    const situation = (state: ReturnType<typeof useSimulation.getState>, event: DrillEvent): DrillContext => ({
      event,
      progress: state.scenarioProgress,
      airPercent: bucketAir(state.air),
      smokeLevel: bucketSmoke(state.smokeIntensity),
      routeStatus: state.routeStatus,
    });
    const unsubscribe = useSimulation.subscribe((state, previous) => {
      if (state.briefingStatus !== "complete" || state.resetSeq !== previous.resetSeq) return;
      const finished = STEPS.find((id) => state.scenarioProgress[id] && !previous.scenarioProgress[id]);
      if (finished) {
        say(situation(state, { kind: "objective", objective: finished }));
        return;
      }
      if (state.sector !== previous.sector && !previous.explored[state.sector]) {
        say(situation(state, { kind: "room", sector: state.sector }));
        return;
      }
      // the objective tells us which room the evacuee is heading for, so render that line
      // now and the voice is already decoded when they walk through the door
      if (state.sector !== previous.sector) {
        const heading = nextScenarioGuidance(state.scenarioProgress);
        if (heading.id !== "complete" && !state.explored[heading.room]) {
          primeLive(situation(state, { kind: "room", sector: heading.room }));
        }
      }
    });
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
    };
  }, [mode]);

  if (!caption) return null;
  return (
    <div key={caption.id} className="hud-rise max-w-[min(40rem,calc(100vw-2rem))] bg-night/85 px-4 py-2.5 text-center text-[14px] leading-snug text-paper" role="status" aria-live="polite">
      <span className="mr-2 text-[10px] font-black uppercase tracking-[0.2em] text-sun">Narrator</span>
      {caption.text}
    </div>
  );
}

/* ------------------------------------------------------------ warden panels */

/** Read-only sector feed. Every warden action lives in the command deck instead. */
function EvidencePanel() {
  const mode = useSimulation((state) => state.mode);
  const view = useSimulation((state) => state.view);
  const evidenceMap = useSimulation((state) => state.evidence);
  const evidence = Object.values(evidenceMap);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (view === "evacuee" || (mode.kind !== "warden" && evidence.length === 0)) return null;

  return (
    <div className="hud-panel pointer-events-auto w-[min(19rem,calc(100vw-1.5rem))] p-3">
      <div className="flex items-baseline justify-between border-b border-paper/15 pb-2">
        <span className="text-[10px] font-black uppercase tracking-[0.18em] text-sun">Sector feed</span>
        <span className="font-mono text-[10px] text-paper/50">{evidence.length}</span>
      </div>
      {evidence.length === 0 ? (
        <p className="mt-3 text-[11px] text-paper/55">Waiting for the sector feed.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {evidence.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-2">
              <span className="truncate text-[11px] text-paper/80">{item.label}</span>
              <span className="flex shrink-0 items-center gap-2 font-mono text-[9px]">
                <span className="text-paper/40">
                  {item.observedAt ? `${Math.max(0, Math.floor((now - item.observedAt) / 1000))}s` : "--"}
                </span>
                <span className="font-black" style={{ color: statusColor(item.status) }}>
                  {item.status}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Log() {
  const log = useSimulation((state) => state.log);
  if (!log.length) return null;
  return (
    <div className="hud-panel w-[min(20rem,calc(100vw-1.5rem))] p-3">
      <div className="mb-2 flex items-center justify-between border-b border-paper/15 pb-2 text-[9px] font-black uppercase tracking-[0.18em] text-paper/55">
        <span>Drill log</span>
        <span>{log.length}/6</span>
      </div>
      <div className="space-y-1.5 text-right">
        {log.map((entry, index) => (
          <div
            key={entry.id}
            className="border-b border-paper/5 pb-1.5 text-[11px] leading-snug last:border-0 last:pb-0"
            style={{
              color: entry.tone === "bad" ? "var(--danger)" : entry.tone === "good" ? "var(--mint)" : "rgba(248,242,234,0.7)",
              opacity: 1 - index * 0.1,
            }}
          >
            {entry.text}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Live / connecting / offline. On a phone, offline practice needs no badge. */
function ConnectionBadge({ compact = false }: { compact?: boolean }) {
  const status = useSession((state) => state.status);
  if (compact && status === "idle") return null;
  const label = status === "connected" ? "Live" : status === "connecting" ? "Connecting" : status === "idle" ? "Offline practice" : status;
  const color = status === "connected" ? "var(--mint)" : status === "idle" ? "var(--violet)" : "var(--sun)";
  return (
    <span className="flex items-center gap-1.5 bg-night/70 px-2 py-1.5 font-mono text-[9px] font-bold uppercase" style={{ color }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function RouteMessageCard() {
  const mode = useSimulation((state) => state.mode);
  const message = useSimulation((state) => state.latestMessage);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);
  if (mode.kind !== "evacuee" || !message || message.expiresAt <= now) return null;
  return (
    <div className="hud-rise max-w-[min(30rem,calc(100vw-1.5rem))] border-2 border-mint bg-night/95 px-4 py-3 shadow-[5px_5px_0_var(--mint)]" role="status" aria-live="polite">
      <div className="text-[10px] font-black uppercase tracking-[0.18em] text-mint">Message from the warden · {message.confidence}</div>
      <div className="mt-1 text-sm font-black uppercase text-paper">{message.caption}</div>
      <div className="mt-0.5 text-[10px] text-paper/55">Disappears in {Math.ceil((message.expiresAt - now) / 1000)}s · you choose the route</div>
    </div>
  );
}

function HazardBanner() {
  const mode = useSimulation((state) => state.mode);
  const air = useSimulation((state) => state.air);
  const smoke = useSimulation((state) => state.smokeIntensity);
  const failed = useSimulation((state) => state.failed);
  const complete = useSimulation((state) => state.assemblyConfirmed);
  const touch = useCoarsePointer();
  const previous = useRef<string | null>(null);
  const warden = mode.kind === "warden";
  const alert = complete
    ? null
    : failed
      ? { label: "Drill ended", detail: "See the debrief to try again.", color: "var(--danger)" }
      : air <= 30
        ? { label: "Air getting thin", detail: "Leave the smoke. Head for a clear room.", color: "var(--danger)" }
        : smoke > 0.2 && !warden
            ? { label: "Smoke in this area", detail: "Keep moving and watch for warden messages.", color: "var(--coral)" }
            : null;
  const alertLabel = alert?.label ?? null;
  useEffect(() => {
    if (alertLabel && previous.current !== alertLabel) playSignal("alert");
    previous.current = alertLabel;
  }, [alertLabel]);
  if (!alert) return null;
  if (touch)
    return (
      <div className="flex items-center gap-2 border-2 bg-night/90 px-2.5 py-1" style={{ borderColor: alert.color }} role="status" aria-live="polite">
        <span className="signal-pulse h-2 w-2 shrink-0 rounded-full" style={{ background: alert.color }} />
        <span className="text-[10px] font-black uppercase tracking-[0.14em]" style={{ color: alert.color }}>
          {alert.label}
        </span>
      </div>
    );
  return (
    <div className="flex max-w-[min(26rem,calc(100vw-1.5rem))] items-center gap-3 border-2 bg-night/90 px-4 py-2.5 shadow-[4px_4px_0_rgba(0,0,0,0.5)]" style={{ borderColor: alert.color }} role="status" aria-live="polite">
      <span className="signal-pulse h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: alert.color }} />
      <div>
        <div className="text-[11px] font-black uppercase tracking-[0.17em]" style={{ color: alert.color }}>
          {alert.label}
        </div>
        <div className="mt-0.5 text-[11px] text-paper/80">{alert.detail}</div>
      </div>
    </div>
  );
}

/**
 * The warden's controls, as one question at a time: what is the next thing to do?
 *
 * The drill has a fixed order - read the sensor, confirm it, send the evacuee west - so the
 * deck shows that order as a three-step track and puts the one action that is ready in a
 * single large button, with a sentence on why. Clearing the smoke is the one optional extra
 * and sits beside it once the route is confirmed. Locked actions are not drawn at all; the
 * track already says what comes next.
 */
function CommandDeck() {
  const mode = useSimulation((state) => state.mode);
  const evidence = useSimulation((state) => state.evidence["east-route-evidence"]);
  const interventionApplied = useSimulation((state) => state.interventionApplied);
  const routeStatus = useSimulation((state) => state.routeStatus);
  const lastAcknowledgement = useSimulation((state) => state.lastAcknowledgement);
  const sendCommand = useSession((state) => state.sendCommand);
  const observeEvidence = useSession((state) => state.observeEvidence);
  const touch = useCoarsePointer();
  const [sent, setSent] = useState<string | null>(null);
  const [routeSent, setRouteSent] = useState(false);
  if (mode.kind !== "warden") return null;

  const status = evidence?.status ?? null;
  const observed = status !== null && status !== "UNKNOWN";
  const verified = status === "VERIFIED";

  const act = (key: string, run: () => void) => () => {
    run();
    setSent(key);
    if (key === "SEND_WEST_ROUTE") setRouteSent(true);
    playSignal("command");
    window.setTimeout(() => setSent((current) => (current === key ? null : current)), 900);
  };

  const track = [
    { label: "Observe", done: observed },
    { label: "Verify", done: verified },
    { label: "Send route", done: routeSent },
  ];
  const active = track.findIndex((step) => !step.done);

  const primary = !evidence
    ? { label: "Waiting for the sector feed", why: "The sensor reading arrives once the drill starts.", color: "#9a8fa3", run: undefined }
    : !observed
      ? { label: "Observe the sensor", why: "Read what the east route sensor is reporting.", color: "#facc15", run: act("OBSERVE", () => observeEvidence(evidence.id)) }
      : !verified
        ? { label: "Verify the east route", why: "Confirm the reading before you guide anyone.", color: "#10b981", run: act("VERIFY_EAST_ROUTE", () => sendCommand("VERIFY_EAST_ROUTE", "east-route-evidence")) }
        : { label: routeSent ? "Send the west route again" : "Send the west route", why: routeSent ? "They have it. Resend if they turn back east." : "Guide the evacuee west, away from the smoke.", color: "#38bdf8", run: act("SEND_WEST_ROUTE", () => sendCommand("SEND_WEST_ROUTE", "east-route-evidence")) };
  const primaryKey = !observed ? "OBSERVE" : !verified ? "VERIFY_EAST_ROUTE" : "SEND_WEST_ROUTE";
  const canClear = verified && !interventionApplied;
  const denied = lastAcknowledgement && !lastAcknowledgement.accepted ? (lastAcknowledgement.reason ?? "denied") : null;

  return (
    <div className={`hud-panel w-full ${touch ? "p-2" : "p-3"} sm:w-[min(30rem,calc(100vw-1.5rem))]`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] font-black uppercase tracking-[0.18em] text-sun">Next action</span>
        <ol className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.12em]">
          {track.map((step, index) => (
            <li key={step.label} className="flex items-center gap-1.5">
              {index > 0 && <span aria-hidden className="h-px w-3 bg-paper/25" />}
              <span className={step.done ? "text-mint" : index === active ? "text-paper" : "text-paper/35"}>
                {step.done ? "✓ " : `${index + 1} `}
                {step.label}
              </span>
            </li>
          ))}
        </ol>
      </div>
      {routeStatus === "unsafe" && !routeSent && (
        <div className="mt-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.14em] text-danger">
          <span className="signal-pulse h-2 w-2 rounded-full bg-danger" />
          East passage unsafe
        </div>
      )}
      <div className="mt-2 flex items-stretch gap-2">
        <button
          onClick={primary.run}
          disabled={!primary.run}
          className="min-w-0 flex-1 border-2 bg-night/70 px-3 py-2 text-left transition enabled:hover:bg-paper/10 disabled:cursor-wait disabled:opacity-60"
          style={{ borderColor: primary.color }}
        >
          <span className="block truncate text-[13px] font-black uppercase tracking-[0.06em]" style={{ color: primary.color }}>
            {sent === primaryKey ? "Sent" : primary.label}
          </span>
          <span className="mt-0.5 block truncate text-[10px] text-paper/60">{primary.why}</span>
        </button>
        {canClear && (
          <button
            onClick={act("APPLY_VENTILATION", () => sendCommand("APPLY_VENTILATION"))}
            className="shrink-0 border-2 border-[#a78bfa] bg-night/70 px-3 py-2 text-left transition hover:bg-paper/10"
          >
            <span className="block text-[11px] font-black uppercase tracking-[0.06em] text-[#a78bfa]">
              {sent === "APPLY_VENTILATION" ? "Sent" : "Clear smoke"}
            </span>
            <span className="mt-0.5 block text-[9px] text-paper/55">once only</span>
          </button>
        )}
      </div>
      {denied && <div className="mt-1.5 font-mono text-[9px] font-black text-danger">{denied}</div>}
    </div>
  );
}

/**
 * Collapses a warden panel down to a toggle on a phone.
 *
 * Stacked, the evidence panel and the log push the minimap and the command deck off a 400px
 * screen entirely. On a desktop they stay exactly as they were.
 */
function PhoneCollapsible({ label, children }: { label: string; children: ReactNode }) {
  const touch = useCoarsePointer();
  const [open, setOpen] = useState(false);
  if (!touch) return <>{children}</>;
  return (
    <div className="pointer-events-auto flex flex-col items-end gap-2">
      <button
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex items-center gap-2 border-2 border-paper/30 bg-night/85 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-paper"
      >
        {label}
        <span aria-hidden className="text-sun">{open ? "–" : "+"}</span>
      </button>
      {open && children}
    </div>
  );
}

/* --------------------------------------------------------------- overlays */

function formatTime(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

type Verdict = { verified: boolean; reasons: string[] };

/**
 * Advisory badge on the end card.
 *
 * Checks the finished drill against its own recorded history. It never changes the result
 * and never explains itself when the check could not run: if AWS is not configured, the
 * query fails or the route is slow, this renders nothing at all rather than accusing a
 * player of cheating because of an infrastructure problem.
 */
function VerificationBadge({ code }: { code: string | null }) {
  const [verdict, setVerdict] = useState<Verdict | null>(null);

  useEffect(() => {
    if (!code) return;
    const abort = new AbortController();
    // a slow check is a check that did not happen; the end screen never waits on it
    const giveUp = window.setTimeout(() => abort.abort(), 6_000);
    fetch(`/api/verify/${code}`, { signal: abort.signal })
      .then((response) => (response.ok ? (response.json() as Promise<Verdict>) : null))
      .then((value) => {
        if (value && typeof value.verified === "boolean") setVerdict(value);
      })
      .catch(() => {
        /* unavailable is not a finding */
      })
      .finally(() => window.clearTimeout(giveUp));
    return () => {
      window.clearTimeout(giveUp);
      abort.abort();
    };
  }, [code]);

  if (!verdict) return null;
  return (
    <div
      className={`mt-5 border-2 border-ink p-3 ${verdict.verified ? "bg-mint/25" : "bg-coral/25"}`}
      role="status"
    >
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2.5 w-2.5 border-2 border-ink"
          style={{ background: verdict.verified ? "var(--mint)" : "var(--coral)" }}
          aria-hidden
        />
        <span className="text-[11px] font-black uppercase tracking-[0.16em]">
          {verdict.verified ? "Verified against the drill record" : "Unverified"}
        </span>
      </div>
      {!verdict.verified && (
        <ul className="mt-2 space-y-1 pl-4 text-[11px] leading-relaxed text-ink-soft">
          {verdict.reasons.map((reason) => (
            <li key={reason} className="list-disc">
              {reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type MailerStage = "idle" | "sending" | "verify" | "sent" | "error";

/** How long the end card keeps watching for the participant to confirm their address. */
const VERIFY_POLL_MS = 3_000;
const VERIFY_WINDOW_MS = 10 * 60_000;

/**
 * Emails the participant their own report.
 *
 * SES will not deliver to an unverified address while the account is in the sandbox, so an
 * unknown address is sent a confirmation link and the run is held server-side. This then
 * polls until it lands, which is why the wait is explained on screen rather than silent.
 */
function ReportMailer() {
  const warden = useSimulation((state) => state.mode.kind === "warden");
  const code = useSession((state) => state.code);
  const [email, setEmail] = useState("");
  const [stage, setStage] = useState<MailerStage>("idle");
  // A returning player is already verified, so the report goes out without the extra step.
  const [knownAddress, setKnownAddress] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const address = email.trim();

  useEffect(() => {
    if (stage !== "verify" || !address) return;
    const startedAt = Date.now();
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      if (Date.now() - startedAt > VERIFY_WINDOW_MS) {
        setTimedOut(true);
        return;
      }
      try {
        const response = await fetch(`/api/report/status?email=${encodeURIComponent(address)}`);
        const body = (await response.json().catch(() => ({}))) as { status?: string };
        if (!cancelled && body.status === "sent") {
          setKnownAddress(false);
          setStage("sent");
          return;
        }
      } catch {
        /* offline or a blip: the next tick tries again */
      }
      if (!cancelled) timer = window.setTimeout(poll, VERIFY_POLL_MS);
    };

    let timer = window.setTimeout(poll, VERIFY_POLL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [stage, address]);

  if (warden) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (stage === "sending" || !address) return;
    setStage("sending");
    setError(null);
    setTimedOut(false);
    try {
      const response = await fetch("/api/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: address, summary: drillSummary(code) }),
      });
      const body = (await response.json().catch(() => ({}))) as { status?: string; error?: string };
      if (response.ok && body.status === "sent") {
        setKnownAddress(true);
        setStage("sent");
      } else if (response.ok && body.status === "verify") setStage("verify");
      else {
        setStage("error");
        setError(body.error ?? "Could not send the report.");
      }
    } catch {
      setStage("error");
      setError("Could not reach the server. Check your connection.");
    }
  };

  if (stage === "sent")
    return (
      <div className="mt-5 border-2 border-ink bg-mint/25 px-3 py-2.5">
        <div className="text-[10px] font-black uppercase tracking-[0.16em]">
          {knownAddress ? "Address already verified - sending now" : "Verified - report sent"}
        </div>
        <p className="mt-0.5 text-[12px] leading-snug">
          {knownAddress ? "No confirmation needed this time. " : "Thanks for confirming. "}
          On its way to <b>{address}</b>. If it is not there in a minute, check spam.
        </p>
      </div>
    );

  if (stage === "verify")
    return (
      <div className="mt-5 border-2 border-ink bg-sun/25 px-3 py-2.5">
        <div className="text-[10px] font-black uppercase tracking-[0.16em]">One step first</div>
        <p className="mt-0.5 text-[12px] leading-snug">
          We sent a confirmation link to <b>{address}</b>. Open it, and your report arrives here within
          a few seconds. Keep this page open.
        </p>
        {timedOut ? (
          <button
            onClick={() => {
              setTimedOut(false);
              setStage("verify");
            }}
            className="mt-2 border-2 border-ink px-2.5 py-1 text-[10px] font-black uppercase tracking-wider"
          >
            Still waiting - check again
          </button>
        ) : (
          <div className="mt-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-ink-soft">
            <span className="inline-block h-2 w-2 animate-pulse bg-ink" aria-hidden />
            Waiting for confirmation
          </div>
        )}
      </div>
    );

  return (
    <form onSubmit={submit} className="mt-5 border-2 border-ink bg-paper-light p-3">
      <label htmlFor="report-email" className="block text-[10px] font-black uppercase tracking-[0.16em]">
        Email me this report
      </label>
      <p className="mt-0.5 text-[11px] leading-snug text-ink-soft">
        Your times, splits and what to practise next. Sent once, to this address only.
      </p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          id="report-email"
          type="email"
          required
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            if (stage === "error") setStage("idle");
          }}
          placeholder="you@example.com"
          autoComplete="email"
          className="min-w-0 flex-1 border-2 border-ink bg-paper px-2.5 py-2 font-mono text-[13px] text-ink outline-none placeholder:text-ink-soft/60 focus:bg-white"
        />
        <button
          type="submit"
          disabled={stage === "sending"}
          className="brutal-button shrink-0 px-4 py-2 text-[12px] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {stage === "sending" ? "Sending..." : "Send report"}
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 border-l-4 border-danger pl-2 text-[11px] leading-snug text-ink">
          {error}
        </p>
      )}
    </form>
  );
}

function EndCard({ onReset, onLeave, onHome }: { onReset: () => void; onLeave: () => void; onHome: () => void }) {
  const complete = useSimulation((state) => state.assemblyConfirmed);
  const failed = useSimulation((state) => state.failed);
  const solo = useSimulation((state) => state.mode.kind === "solo");
  const warden = useSimulation((state) => state.mode.kind === "warden");
  const routeStatus = useSimulation((state) => state.routeStatus);
  const interventionApplied = useSimulation((state) => state.interventionApplied);
  const latestMessage = useSimulation((state) => state.latestMessage);
  const progress = useSimulation((state) => state.scenarioProgress);
  const elapsed = useSimulation((state) => state.hazardElapsed);
  const health = useSimulation((state) => state.health);
  const reset = useSimulation((state) => state.reset);
  const room = useSession((state) => state.room);
  const code = useSession((state) => state.code);
  const abandoned = resolveRoom(room)?.outcome === "participant-left";
  const touch = useCoarsePointer();
  if (!complete && !failed) return null;
  const done = CRITICAL_SCENARIO_OBJECTS.filter((id) => progress[id]).length;
  const coordination = abandoned
    ? "A participant disconnected and did not come back before the countdown ran out, so the drill was ended."
    : failed
    ? "The evacuee did not reach the exit before their air or health ran out."
    : latestMessage
      ? "A route message was delivered. Was it early enough to matter?"
      : "The drill finished without a route message from a warden.";
  const practice = interventionApplied
    ? "Verify the route evidence before applying the ventilation override."
    : routeStatus === "unsafe"
      ? "Decide on the alternate route earlier."
      : "Verify the evidence before sending a route message.";
  const debrief: [string, string, string][] = [
    [
      "Did we get out safely?",
      complete
        ? "Yes. The evacuee left through the marked exit."
        : abandoned
          ? "No. The drill ended when a participant dropped out mid-run."
          : "No. The drill ended before the exit.",
      "var(--mint)",
    ],
    ["Where did coordination slip?", coordination, "var(--sun)"],
    ["What do we practise next?", practice, "var(--violet)"],
  ];
  const actions = (
    <div className={`grid gap-3 ${touch ? "mt-3 grid-cols-2" : "mt-6 sm:grid-cols-2"}`}>
      {solo ? (
        <button
          onClick={() => {
            reset();
            onReset();
          }}
          className={`brutal-button px-4 ${touch ? "py-2" : "py-3"}`}
        >
          Play again
        </button>
      ) : (
        <button onClick={onLeave} className={`brutal-button px-4 ${touch ? "py-2" : "py-3"}`}>
          Back to lobby
        </button>
      )}
      <button onClick={onHome} className={`brutal-button px-4 ${touch ? "py-2" : "py-3"}`} style={{ background: "var(--paper-light)" }}>
        Exit to home
      </button>
    </div>
  );
  return (
    <div className={`pointer-events-auto absolute inset-0 z-50 grid place-items-center overflow-y-auto bg-night/75 backdrop-blur-sm ${touch ? "p-2" : "p-4"}`}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="end-title"
        className={`brutal-panel w-full text-ink ${touch ? "max-w-3xl p-4" : "max-w-lg p-5 sm:p-7"}`}
      >
        {/* sideways on a phone: result and actions on the left, the debrief beside them */}
        <div className={touch ? "grid grid-cols-2 gap-4" : ""}>
          <div>
            <span className={`brutal-tag ${complete ? "bg-mint" : "bg-coral"}`}>{complete ? "Drill complete" : "Drill ended"}</span>
            <h2 id="end-title" className={`mt-3 font-black uppercase leading-[0.95] tracking-[-0.05em] ${touch ? "text-2xl" : "text-4xl"}`}>
              {complete ? (warden ? "They got out safely." : "You got out safely.") : abandoned ? "A player did not return." : "Not this time."}
            </h2>
            <dl className={`grid grid-cols-3 border-2 border-ink bg-paper ${touch ? "mt-3" : "mt-5"}`}>
              {(
                [
                  ["Time", formatTime(elapsed)],
                  ["Steps", `${done}/${CRITICAL_SCENARIO_OBJECTS.length}`],
                  ["Health", String(Math.round(health))],
                ] as const
              ).map(([label, value], index) => (
                <div key={label} className={`${touch ? "p-2" : "p-3"} ${index ? "border-l-2 border-ink" : ""}`}>
                  <dt className="text-[9px] font-black uppercase tracking-[0.18em] text-ink-soft">{label}</dt>
                  <dd className={`mt-1 font-mono font-black ${touch ? "text-lg" : "text-2xl"}`}>{value}</dd>
                </div>
              ))}
            </dl>
            {touch && actions}
          </div>
          <div>
            <div className={touch ? "space-y-2" : "mt-5 space-y-3"}>
              {debrief.map(([question, answer, color]) => (
                <div key={question} className="border-l-4 pl-3" style={{ borderColor: color }}>
                  <div className="text-[10px] font-black uppercase tracking-[0.16em]">{question}</div>
                  <div className={`mt-0.5 text-ink-soft ${touch ? "text-[12px] leading-snug" : "text-sm"}`}>{answer}</div>
                </div>
              ))}
            </div>
            {!solo && <VerificationBadge code={code} />}
            <ReportMailer />
          </div>
        </div>
        {!touch && actions}
      </section>
    </div>
  );
}

const noExternalStoreSubscribe = () => () => {};

function readOnboardingOpen() {
  try {
    return localStorage.getItem("campusevac:onboarding:v2") !== "complete";
  } catch {
    return true;
  }
}

/**
 * A returning player skips the onboarding card and the briefing waits for their first touch
 * (the browser will not play the voice before one). Without a cue the screen just sits there
 * with the controls hidden, so say what starts it.
 */
const noSubscription = () => () => {};

function TapToBegin() {
  const status = useSimulation((state) => state.briefingStatus);
  const warden = useSimulation((state) => state.mode.kind === "warden");
  const touch = useCoarsePointer();
  // read from storage on the client only; the server render has no player to recognise
  const returning = useSyncExternalStore(
    noSubscription,
    () => !readOnboardingOpen(),
    () => false,
  );
  if (!returning || warden || status !== "locked") return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[18%] z-30 flex justify-center">
      <div className="signal-pulse border-2 border-sun bg-night/85 px-4 py-2 text-[11px] font-black uppercase tracking-[0.2em] text-sun">
        {touch ? "Tap anywhere to begin" : "Click or press any key to begin"}
      </div>
    </div>
  );
}

function Onboarding() {
  const mode = useSimulation((state) => state.mode);
  const storedOpen = useSyncExternalStore(noExternalStoreSubscribe, readOnboardingOpen, () => false);
  const [dismissed, setDismissed] = useState(false);
  // a phone held sideways has ~360px of height: the card has to fit it without scrolling
  const touch = useCoarsePointer();
  const open = storedOpen && !dismissed;
  if (!open) return null;
  const warden = mode.kind === "warden";
  const finish = () => {
    try {
      localStorage.setItem("campusevac:onboarding:v2", "complete");
    } catch {
      /* session-only dismissal */
    }
    window.dispatchEvent(new Event("start-briefing"));
    setDismissed(true);
  };
  return (
    <div className="pointer-events-auto absolute inset-0 z-50 grid place-items-center overflow-y-auto bg-night/70 p-4 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        className={`brutal-panel w-full text-ink ${touch ? "max-w-2xl p-4" : "max-w-xl p-5 sm:p-7"}`}
      >
        <span className="brutal-tag bg-sun">How to play</span>
        <h2
          id="onboarding-title"
          className={`mt-3 font-black uppercase leading-[0.95] tracking-[-0.05em] ${touch ? "text-xl" : "text-3xl"}`}
        >
          {warden ? "You see the danger. Talk them out." : "Six steps. Then get out."}
        </h2>
        <p className={`mt-2 text-sm leading-relaxed text-ink-soft ${touch ? "hidden" : ""}`}>
          {warden
            ? "You watch the evacuee's sector, check the evidence and send route messages. They cannot see the hazards you see."
            : "A short narrated briefing plays first. Your controls unlock when it ends. The steps stay on screen the whole time."}
        </p>
        {warden ? (
          <ol className={`grid gap-2 ${touch ? "mt-3 grid-cols-2 text-[12px]" : "mt-5 text-sm"}`}>
            {[
              ["Watch", "Follow the evacuee through your sector."],
              ["Observe", "Open Evidence and inspect what changed."],
              ["Verify", "Confirm it before you act on it."],
              ["Message", "Send one clear route message."],
            ].map(([title, detail], index) => (
              <li key={title} className="flex gap-3 border-2 border-ink bg-paper px-3 py-2">
                <span className="font-mono font-black text-coral">{index + 1}</span>
                <span>
                  <b className="uppercase">{title}.</b> {detail}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <div className={`grid grid-cols-2 ${touch ? "mt-3 gap-3" : "mt-5 gap-4"}`}>
            <ol className={touch ? "space-y-1 text-[12px]" : "space-y-1.5 text-sm"}>
              {STEPS.map((id, index) => (
                <li key={id} className="flex gap-2">
                  <span className="w-4 font-mono font-black text-coral">{index + 1}</span>
                  <span>
                    <b>{scenarioObjectById(id).label}</b>
                    {!touch && <span className="text-ink-soft"> · {placeName(id)}</span>}
                  </span>
                </li>
              ))}
            </ol>
            <div className={`border-2 border-ink bg-paper font-bold uppercase tracking-wider ${touch ? "space-y-1 p-2 text-[10px]" : "space-y-2 p-3 text-[11px]"}`}>
              {(touch
                ? ([
                    ["Stick", "Move · push to the edge to run"],
                    ["Drag", "Look around"],
                    ["E", "Use"],
                    ["Jump", "Jump"],
                    ["Cam", "Switch camera"],
                    ["❚❚", "Pause menu"],
                  ] as const)
                : ([
                    ["WASD", "Move"],
                    ["Shift", "Sprint"],
                    ["Space", "Jump"],
                    ["E", "Interact"],
                    ["V", "Switch camera"],
                    ["Esc", "Pause menu"],
                  ] as const)
              ).map(([key, label]) => (
                <div key={key} className="flex items-center gap-2">
                  <Key light small>
                    {key}
                  </Key>
                  {label}
                </div>
              ))}
            </div>
          </div>
        )}
        <button onClick={finish} className={`brutal-button w-full px-4 ${touch ? "mt-3 py-2.5" : "mt-6 py-3"}`}>
          {warden ? "Open warden station" : "Start the briefing"}
        </button>
      </section>
    </div>
  );
}

function Briefing() {
  const mode = useSimulation((state) => state.mode);
  const beginBriefing = useSimulation((state) => state.beginBriefing);
  const completeBriefing = useSimulation((state) => state.completeBriefing);
  const [line, setLine] = useState("");
  const [open, setOpen] = useState(false);
  const [slide, setSlide] = useState(0);
  const [lines, setLines] = useState(EVACUEE_BRIEFING);
  const [provider, setProvider] = useState<"bedrock" | "authored">("authored");
  const [voice, setVoice] = useState(true);
  const touch = useCoarsePointer();
  const step = useRef(0);
  const run = useRef(0);

  useEffect(() => {
    if (mode.kind === "warden") return;
    let disposed = false;
    const start = () => {
      if (useSimulation.getState().briefingStatus === "playing") return;
      // still inside the tap that started it, which fullscreen and the lock both require
      void enterLandscape();
      const token = ++run.current;
      const live = () => !disposed && run.current === token;
      beginBriefing();
      setOpen(true);
      setSlide(0);
      setVoice(readVoiceEnabled());
      setProvider("authored");
      setLine("Preparing your briefing...");
      void loadBedrockBriefing().then((briefing) => {
        if (!live()) return;
        setLines(briefing.lines);
        setProvider(briefing.provider);
        step.current = 0;
        const speakNext = () => {
          if (!live()) return;
          const next = briefing.lines[step.current];
          if (!next) {
            setLine("Briefing complete. You can move now.");
            window.setTimeout(() => {
              if (!live()) return;
              run.current += 1;
              completeBriefing();
              setOpen(false);
            }, 900);
            return;
          }
          setSlide(step.current);
          setLine(next);
          const cue = briefingCue(step.current, next);
          step.current += 1;
          speakNarration(cue, speakNext);
        };
        playSignal("command");
        speakNext();
      });
    };
    window.addEventListener("start-briefing", start);

    // A returning player skips the onboarding card, so the briefing used to begin on a timer
    // 700ms after mount — which in solo practice is simply "the page loaded". Opening the tab
    // would start talking at you. Wait for the player to actually touch the game instead.
    // That is also the gesture the browser requires before any audio may play, so the voice
    // can never be queued up now and erupt later.
    let waitForPlayer: (() => void) | undefined;
    try {
      if (localStorage.getItem("campusevac:onboarding:v2") === "complete") {
        const begin = () => {
          waitForPlayer?.();
          waitForPlayer = undefined;
          start();
        };
        for (const event of ["pointerdown", "keydown", "touchstart"]) {
          window.addEventListener(event, begin, { once: true, passive: true });
        }
        waitForPlayer = () => {
          for (const event of ["pointerdown", "keydown", "touchstart"]) {
            window.removeEventListener(event, begin);
          }
        };
      }
    } catch {
      /* transcript remains available from the mission brief */
    }

    return () => {
      disposed = true;
      window.removeEventListener("start-briefing", start);
      waitForPlayer?.();
      stopNarration();
    };
  }, [beginBriefing, completeBriefing, mode.kind]);

  if (mode.kind === "warden" || !open) return null;

  const skip = () => {
    run.current += 1;
    stopNarration();
    completeBriefing();
    setOpen(false);
  };

  return (
    <div className="pointer-events-auto absolute inset-0 z-50 grid place-items-center overflow-y-auto bg-night/85 p-4 backdrop-blur-md">
      <section
        className={`brutal-panel-dark w-full ${touch ? "max-w-3xl p-3" : "max-w-2xl p-4 sm:p-6"}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="briefing-title"
      >
        <div className={`flex items-start justify-between gap-4 border-b border-paper/15 ${touch ? "pb-2" : "pb-4"}`}>
          <div>
            <span className="brutal-tag bg-sun text-ink">Briefing</span>
            <h2 id="briefing-title" className={`mt-2 font-black uppercase tracking-[-0.04em] ${touch ? "text-lg" : "text-2xl sm:text-3xl"}`}>
              Listen first. Then move.
            </h2>
          </div>
          <div className="shrink-0 text-right font-mono text-[10px] uppercase tracking-widest text-paper/55">
            <div className="text-lg font-black text-sun">
              {Math.min(slide + 1, lines.length)}/{lines.length}
            </div>
            <div>controls locked</div>
          </div>
        </div>
        {/* sideways on a phone the artwork sits beside the words, or the card outgrows the screen */}
        <div className={touch ? "mt-3 grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] items-start gap-3" : ""}>
        <div className={touch ? "" : "mt-4"}>
          <BriefingArtwork slide={slide} />
        </div>
        <div>
        <div className={`border-l-4 border-sun bg-paper/5 ${touch ? "px-3 py-2" : "mt-4 px-4 py-3"}`} aria-live="polite">
          <div className="flex items-center justify-between gap-3 text-[10px] font-black uppercase tracking-[0.18em] text-sun">
            <span>Narrator</span>
            {provider === "bedrock" && <span className="text-paper/50">Amazon Bedrock</span>}
          </div>
          <div className={`mt-1 leading-relaxed text-paper ${touch ? "text-[13px] leading-snug" : "text-base sm:text-lg"}`}>{line}</div>
        </div>
        <div className={`h-2 border border-paper/20 bg-black/40 ${touch ? "mt-2" : "mt-4"}`}>
          <div className="h-full bg-sun transition-[width] duration-500" style={{ width: `${Math.min(100, ((slide + 1) / Math.max(1, lines.length)) * 100)}%` }} />
        </div>
        <div className={`flex flex-wrap items-center justify-between gap-3 ${touch ? "mt-2" : "mt-4"}`}>
          <button
            onClick={() => {
              writeVoiceEnabled(!voice);
              setVoice(!voice);
            }}
            className="border-2 border-paper/25 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-paper/80 hover:border-paper/60"
            aria-pressed={voice}
          >
            Voice: {voice ? "on" : "off"}
          </button>
          <button onClick={skip} className="brutal-button-dark px-4 py-2.5">
            Skip briefing
          </button>
        </div>
        </div>
        </div>
      </section>
    </div>
  );
}

function requestCanvasLock() {
  const canvas = document.querySelector<HTMLCanvasElement>(".drill-surface canvas");
  if (!canvas) return;
  try {
    const result = canvas.requestPointerLock() as unknown as Promise<void> | void;
    if (result && typeof result.catch === "function") result.catch(() => {});
  } catch {
    /* the next click on the canvas locks it */
  }
}

/**
 * Shown on every screen while a participant is missing.
 *
 * The drill is frozen through the existing `paused` flag rather than a second mechanism, so
 * movement, interaction and the hazard clock all stop for free. The countdown is local: it
 * starts when this client first sees the drop, which is close enough on a two-seat drill and
 * avoids putting a deadline into the room snapshot for clients to disagree about.
 */

function WaitingForPlayer() {
  const room = useSession((state) => state.room);
  const setPaused = useSimulation((state) => state.setPaused);
  const resolved = resolveRoom(room);
  const missing =
    resolved?.phase === "active" ? resolved.participants.find((item) => item.connected === false) : undefined;

  const [remaining, setRemaining] = useState(RECONNECT_GRACE_MS);
  const autoPaused = useRef(false);

  // the room is what knows the grace period expired; the local sim drives the end card
  const failSim = useSimulation((state) => state.fail);
  const outcome = resolved?.outcome;
  useEffect(() => {
    if (outcome === "participant-left") failSim("a participant did not return");
  }, [outcome, failSim]);

  // Show a full ten seconds on the first paint rather than the previous run's zero. This is
  // the derived-state-during-render pattern, so it stays pure: the deadline itself is read
  // from the clock inside the effect.
  const missingId = missing?.id ?? null;
  const [trackedId, setTrackedId] = useState<string | null>(null);
  if (missingId !== trackedId) {
    setTrackedId(missingId);
    setRemaining(RECONNECT_GRACE_MS);
  }

  useEffect(() => {
    if (!missingId) {
      // only lift the pause this overlay put in place, never the player's own pause menu
      if (autoPaused.current) {
        autoPaused.current = false;
        setPaused(false);
      }
      return;
    }
    autoPaused.current = true;
    setPaused(true);
    const endsAt = Date.now() + RECONNECT_GRACE_MS;
    const tick = window.setInterval(() => setRemaining(Math.max(0, endsAt - Date.now())), 100);
    return () => window.clearInterval(tick);
  }, [missingId, setPaused]);

  if (!missing) return null;
  const seconds = Math.ceil(remaining / 1000);

  return (
    <div className="pointer-events-auto absolute inset-0 z-[60] grid place-items-center overflow-y-auto bg-night/85 p-4 backdrop-blur-sm">
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="waiting-title"
        className="brutal-panel-dark w-full max-w-md p-5 text-center sm:p-6"
      >
        <span className="brutal-tag bg-danger text-paper">Connection lost</span>
        <h2 id="waiting-title" className="mt-4 text-3xl font-black uppercase leading-none tracking-[-0.05em]">
          Waiting for {missing.name}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-paper/70">
          The drill is paused. Air and smoke are frozen until they are back.
        </p>
        <div className="mt-6 font-mono text-6xl font-black leading-none text-sun" aria-live="polite">
          {seconds}
        </div>
        <div className="mt-3 h-2 w-full border-2 border-paper/25">
          <div
            className="h-full bg-sun transition-[width] duration-100 ease-linear"
            style={{ width: `${(remaining / RECONNECT_GRACE_MS) * 100}%` }}
          />
        </div>
        <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.14em] text-paper/45">
          The drill ends if they do not return
        </p>
      </section>
    </div>
  );
}

function PauseMenu({ onRestart, onLeave, onHome }: { onRestart: () => void; onLeave: () => void; onHome: () => void }) {
  const paused = useSimulation((state) => state.paused);
  const setPaused = useSimulation((state) => state.setPaused);
  const mode = useSimulation((state) => state.mode);
  const view = useSimulation((state) => state.view);
  const setView = useSimulation((state) => state.setView);
  const cameraMode = useSimulation((state) => state.cameraMode);
  const toggleCameraMode = useSimulation((state) => state.toggleCameraMode);
  const touch = useCoarsePointer();
  const quality = useGraphicsQuality(touch);
  const [voice, setVoice] = useState(true);
  const [wasPaused, setWasPaused] = useState(paused);
  if (paused !== wasPaused) {
    setWasPaused(paused);
    if (paused) setVoice(readVoiceEnabled());
  }
  if (!paused) return null;
  const solo = mode.kind === "solo";
  const warden = mode.kind === "warden";
  const resume = () => {
    setPaused(false);
    if (touch) void enterLandscape();
    if (view === "evacuee" && !touch) requestCanvasLock();
  };
  // Sideways on a phone the menu has ~360px of height, so it goes two columns and tighter.
  const row = `flex w-full items-center justify-between gap-2 border-2 border-paper/20 text-left text-[11px] font-black uppercase tracking-[0.14em] text-paper hover:border-paper/60 ${touch ? "px-3 py-2" : "px-4 py-3"}`;

  return (
    <div className={`pointer-events-auto absolute inset-0 z-50 grid place-items-center overflow-y-auto bg-night/75 backdrop-blur-sm ${touch ? "p-2" : "p-4"}`}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="pause-title"
        className={`brutal-panel-dark w-full ${touch ? "max-w-2xl p-4" : "max-w-md p-5 sm:p-6"}`}
      >
        <div className="flex items-center justify-between">
          <span className="brutal-tag bg-sun text-ink">Paused</span>
          <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-paper/55">
            {touch ? "Tap resume to continue" : <><Key small>Esc</Key> to resume</>}
          </span>
        </div>
        <h2 id="pause-title" className={`font-black uppercase tracking-[-0.05em] ${touch ? "sr-only" : "mt-3 text-3xl"}`}>
          Take a breath.
        </h2>
        <div className={touch ? "mt-3 grid grid-cols-2 gap-2" : "mt-5 space-y-2.5"}>
          <button onClick={resume} className={`brutal-button w-full px-4 ${touch ? "col-span-2 py-2.5" : "py-3"}`}>
            Resume
          </button>
          {solo && (
            <button
              onClick={() => {
                setPaused(false);
                onRestart();
              }}
              className={row}
            >
              Restart drill {!touch && <span className="text-paper/50">from the entrance</span>}
            </button>
          )}
          {!warden && (
            <button onClick={toggleCameraMode} className={row}>
              Camera{" "}
              <span className="text-sun">
                {cameraMode === "third" ? (touch ? "Shoulder" : "Over the shoulder") : "First person"}
              </span>
            </button>
          )}
          <button
            onClick={() => {
              writeVoiceEnabled(!voice);
              setVoice(!voice);
            }}
            className={row}
            aria-pressed={voice}
          >
            Voice narration <span className="text-sun">{voice ? "On" : "Off"}</span>
          </button>
          <button
            onClick={() => setGraphicsQuality(quality === "high" ? "low" : "high")}
            className={row}
            aria-pressed={quality === "high"}
          >
            Graphics <span className="text-sun">{quality === "high" ? "Cinematic" : "Fast"}</span>
          </button>
          {solo && (
            <div className={`grid grid-cols-3 gap-2 ${touch ? "col-span-2" : ""}`}>
              {VIEWS.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setView(item.id)}
                  className={`border-2 px-2 ${touch ? "py-1.5" : "py-2"} text-[9px] font-black uppercase tracking-wider ${view === item.id ? "border-sun bg-sun text-ink" : "border-paper/20 text-paper/75 hover:border-paper/60"}`}
                >
                  {item.title}
                </button>
              ))}
            </div>
          )}
        </div>
        {!warden && !touch && (
          <details className="mt-4 border-2 border-paper/15 px-4 py-3 text-sm text-paper/80">
            <summary className="cursor-pointer text-[11px] font-black uppercase tracking-[0.14em] text-paper">How to play</summary>
            <ol className="mt-3 space-y-1">
              {STEPS.map((id, index) => (
                <li key={id}>
                  <span className="mr-2 font-mono text-coral">{index + 1}</span>
                  {scenarioObjectById(id).label} <span className="text-paper/45">· {placeName(id)}</span>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-[11px] text-paper/55">WASD move · Shift sprint · Space jump · E interact · V camera · Tab steps · Esc menu</p>
          </details>
        )}
        <div className={`grid gap-2.5 border-t border-paper/15 sm:grid-cols-2 ${touch ? "mt-3 pt-3" : "mt-5 pt-5"}`}>
          {!solo && (
            <button onClick={onLeave} className="border-2 border-coral px-4 py-2 sm:py-3 text-[11px] font-black uppercase tracking-[0.14em] text-coral hover:bg-coral hover:text-ink">
              Leave drill
            </button>
          )}
          <button onClick={onHome} className={`border-2 border-coral px-4 ${touch ? "py-2" : "py-3"} text-[11px] font-black uppercase tracking-[0.14em] text-coral hover:bg-coral hover:text-ink ${solo ? "sm:col-span-2" : ""}`}>
            Exit to home
          </button>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------- shell */

export default function DrillShell({ title }: { title?: string }) {
  const router = useRouter();
  const mode = useSimulation((state) => state.mode);
  const view = useSimulation((state) => state.view);
  const setView = useSimulation((state) => state.setView);
  const setPaused = useSimulation((state) => state.setPaused);
  // Air, health and smoke change every hazard tick; they are read by the panels that show
  // them, never here, or the whole shell - canvas included - would re-render ten times a second.
  const reset = useSimulation((state) => state.reset);
  const leave = useSession((state) => state.leave);
  const onRouteMessage = useSession((state) => state.onRouteMessage);
  const onAcknowledgement = useSession((state) => state.onAcknowledgement);
  const onWardenState = useSession((state) => state.onWardenState);
  const observeEvidence = useSession((state) => state.observeEvidence);
  const touch = useCoarsePointer();
  const solo = mode.kind === "solo";
  const warden = mode.kind === "warden";
  const showStick = touch && view === "evacuee";

  useEffect(() => {
    if (!solo) return;
    const onKey = (event: KeyboardEvent) => {
      const index = ["Digit1", "Digit2", "Digit3"].indexOf(event.code);
      if (index >= 0) setView(VIEWS[index].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setView, solo]);

  // Esc opens the menu. While the mouse is captured the browser eats that Esc to release the
  // pointer, so losing the lock mid-drill opens the menu too.
  useEffect(() => {
    const idle = () => {
      const state = useSimulation.getState();
      return state.failed || state.assemblyConfirmed || state.briefingStatus !== "complete";
    };
    const onLockChange = () => {
      const state = useSimulation.getState();
      if (document.pointerLockElement || state.view !== "evacuee" || idle()) return;
      state.setPaused(true);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "Escape" && event.code !== "KeyP") return;
      const state = useSimulation.getState();
      if (document.pointerLockElement) {
        if (event.code === "KeyP") document.exitPointerLock();
        return;
      }
      if (!state.paused && idle()) return;
      state.setPaused(!state.paused);
    };
    document.addEventListener("pointerlockchange", onLockChange);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerlockchange", onLockChange);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    return onRouteMessage((message: RouteMessage) => useSimulation.getState().receiveRouteMessage(message));
  }, [onRouteMessage]);

  useEffect(() => {
    return onAcknowledgement((acknowledgement) => useSimulation.getState().receiveAcknowledgement(acknowledgement));
  }, [onAcknowledgement]);

  // Warden snapshots drive the HUD and the remote evacuee marker. They are applied
  // here, outside the canvas, so the station stays live before the 3D view mounts.
  useEffect(() => {
    if (!warden) return;
    return onWardenState((state) => {
      runtime.netEvacuee = state.evacuee
        ? {
            x: state.evacuee.position[0],
            y: state.evacuee.position[1],
            z: state.evacuee.position[2],
            yaw: state.evacuee.position[3],
            hasBackpack: state.hasBackpack,
            equipped: state.equipped,
            scenarioProgress: state.scenarioProgress,
          }
        : null;
      if (state.evacuee) {
        runtime.sector = state.evacuee.sectorId;
        runtime.evacueeYaw = state.evacuee.position[3];
      }
      runtime.alert = state.smokeIntensity * 100;
      useSimulation.getState().applyWardenState(state);
    });
  }, [onWardenState, warden]);

  useEffect(() => {
    const inspect = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string }>).detail;
      if (detail?.id && warden) {
        observeEvidence(detail.id);
        playSignal("evidence");
      }
    };
    window.addEventListener("inspect-evidence", inspect);
    return () => window.removeEventListener("inspect-evidence", inspect);
  }, [observeEvidence, warden]);

  const exitLock = () => {
    if (document.pointerLockElement) document.exitPointerLock();
  };
  const restart = () => {
    reset();
    setView("evacuee");
    window.dispatchEvent(new Event("start-briefing"));
  };
  const leaveDrill = () => {
    stopNarration();
    leave();
    router.push("/simulation/rooms");
  };
  const goHome = () => {
    stopNarration();
    if (!solo) leave();
    router.push("/");
  };

  const tag = title ?? (warden ? "Warden" : mode.kind === "evacuee" ? "Evacuee" : "Solo practice");
  const evacueeHud = !warden && view === "evacuee";

  return (
    <div className="drill-surface absolute inset-0 overflow-hidden bg-night text-paper">
      <DrillCanvas />
      <Briefing />

      {/* top left: where, what next, and how the evacuee is doing */}
      <div className="safe-top hud-left pointer-events-none absolute top-0 z-10 flex max-w-[58vw] flex-col items-start gap-2 sm:max-w-none sm:gap-3">
        <LocationHeader tag={tag} compact={touch} />
        {evacueeHud ? (
          <>
            <ObjectivesPanel />
            {touch && <Vitals compact />}
          </>
        ) : (
          <EvacueeStatus hint={warden || touch ? undefined : "Press 1 to return to the evacuee."} />
        )}
      </div>

      {/* top right: status, menu, map, and the evidence feed when asked for */}
      <div className="safe-top hud-right pointer-events-none absolute top-0 z-10 flex max-h-[calc(100%-1.5rem)] max-w-[52vw] flex-col items-end gap-2 overflow-y-auto sm:max-w-none">
        <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-2">
          <ConnectionBadge compact={touch} />
          {warden && (
            <div className="flex overflow-hidden border-2 border-paper/30">
              {(["warden", "evidence"] as ViewMode[]).map((id) => (
                <button
                  key={id}
                  onClick={() => setView(id)}
                  className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-widest ${view === id ? "bg-sun text-ink" : "bg-night/85 text-paper/65 hover:bg-paper/10"}`}
                >
                  {id === "warden" ? "Watch" : "Evidence"}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => {
              exitLock();
              setPaused(true);
            }}
            className={`flex items-center gap-2 border-2 border-paper/30 bg-night/85 text-[10px] font-black uppercase tracking-[0.16em] text-paper hover:border-paper/70 ${touch ? "px-2.5 py-1.5" : "px-3 py-1.5"}`}
            aria-label="Open the menu"
          >
            <span aria-hidden className="text-sun">
              ❚❚
            </span>
            {!touch && "Menu"}
          </button>
        </div>
        <Minimap compact={touch} />
        {view === "evidence" && (
          <>
            <PhoneCollapsible label="Evidence">
              <EvidencePanel />
            </PhoneCollapsible>
            <PhoneCollapsible label="Log">
              <Log />
            </PhoneCollapsible>
          </>
        )}
      </div>

      {/* alerts: mid-screen on a desktop, along the top edge on a phone where the middle is the view */}
      <div className={`pointer-events-none absolute inset-x-0 z-10 flex flex-col items-center gap-2 px-3 ${touch ? "safe-top top-1" : "top-[34%] xl:top-4"}`}>
        <HazardBanner />
        <RouteMessageCard />
      </div>

      {warden && (
        <div className="pointer-events-auto absolute inset-x-2 bottom-3 z-10 sm:inset-x-auto sm:bottom-4 sm:left-1/2 sm:-translate-x-1/2">
          <CommandDeck />
        </div>
      )}

      {/* bottom left: the evacuee's own vitals on a desktop (a phone keeps them top left) */}
      {evacueeHud && !touch && (
        <div className="hud-left pointer-events-none absolute bottom-3 z-10 sm:bottom-4">
          <Vitals />
        </div>
      )}

      {/* bottom centre: narration, interaction prompt, controls */}
      {!warden && (
        <div className={`pointer-events-none absolute inset-x-0 z-10 flex flex-col items-center gap-2 px-3 ${showStick ? "above-dock" : "bottom-3 sm:bottom-4"} ${view === "evacuee" ? "" : "hidden"}`}>
          <NarrationCaption />
          {!showStick && <PromptBar />}
          {!touch && <div className="hidden lg:block"><ControlsHint /></div>}
        </div>
      )}

      {evacueeHud && <AirVignette />}
      {evacueeHud && <RoomTitle />}
      {view === "evacuee" && !showStick && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <span className="block h-1.5 w-1.5 rounded-full bg-paper shadow-[0_0_0_2px_rgba(22,17,30,0.6)]" />
        </div>
      )}
      {showStick && <TouchControls />}
      <Onboarding />
      <TapToBegin />
      <PortraitBlock />
      <WaitingForPlayer />
      <PauseMenu onRestart={restart} onLeave={leaveDrill} onHome={goHome} />
      <EndCard onReset={restart} onLeave={leaveDrill} onHome={goHome} />
    </div>
  );
}
