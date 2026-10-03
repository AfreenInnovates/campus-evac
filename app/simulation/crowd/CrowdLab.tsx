"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ScorecardView } from "./Scorecard";
import { auditDrill, playReplay, takeReplay, debrief, findings, humanBroadcast, lab, MAX_RUN_SECONDS, RUN_BUDGET_USD, setRunning, setupRun, summarise, useLab, type LabConfig, type RunResult, type WardenMode } from "./engine";
import { MODELS } from "./prompts";
import { useSpectator } from "./CrowdScene";
import { PortraitBlock } from "../components/PortraitBlock";
import { enterLandscape } from "../orientation";
import { adminKey, hydratePlaybook, nextDrillNumber, recordPoint, usePlaybook } from "./playbook";
import { findReplay, replayById, saveReplay, shareReplay, type Replay } from "./replay";
import AuditPanel, { beginAudit, beginTrial, recordAuditDrill } from "./Audit";
import TrainingPanel, { type QueueItem } from "./Training";
import { Caption, PABanner, Scoreboard, useStory, VoiceToggle } from "./Story";
import { pauseVoice, resumeVoice, setVoiceRate, speak, stopSpeaking } from "./voice";
import { OrdersPanel, ThoughtsFeed } from "./Coordination";
import { DEMO_PLAN, placeName, SCENARIOS, usePlan } from "./world";
import FloorDesigner, { chooseFloor, savedFloor, useSavedFloor } from "./FloorDesigner";
import { peopleIn, planFor, type BuildingSpec } from "./floorplan";

const CrowdScene = dynamic(() => import("./CrowdScene"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 grid place-items-center text-xs font-black uppercase tracking-[0.3em] text-paper/60">Loading the building…</div>
  ),
});

const EXPERIMENTS_KEY = "campusevac:crowd-experiments";

function readExperiments(): RunResult[] {
  try {
    return JSON.parse(localStorage.getItem(EXPERIMENTS_KEY) ?? "[]") as RunResult[];
  } catch {
    return [];
  }
}

function saveExperiment(result: RunResult) {
  try {
    const list = [result, ...readExperiments().filter((r) => r.id !== result.id)].slice(0, 40);
    localStorage.setItem(EXPERIMENTS_KEY, JSON.stringify(list));
  } catch {
    /* experiments last for this page only */
  }
}

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const WARDEN_LABEL: Record<WardenMode, string> = { ai: "AI warden (vision)", human: "You are the warden", none: "No warden" };

function Panel({ title, right, children, className = "" }: { title: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`hud-panel pointer-events-auto flex min-h-0 flex-col p-3 ${className}`}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-sun">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ setup */

export const DEFAULT_CONFIG: LabConfig = { scenarioId: SCENARIOS[0].id, agents: 12, warden: "ai", seed: 7, wardenEvery: 12, playbook: true };

/** A new drill puts new people in new places; only an explicit seed (or "run again") repeats one. */
export const freshSeed = () => 1 + Math.floor(Math.random() * 999_999);

/**
 * One choice and one button. Where the fire starts is the only thing most people want to
 * pick; the knobs for experiments fold away under "More options".
 */
function Setup({ onStart, onAudit, onDesign, compact = false }: { onStart: (config: LabConfig) => void; onAudit: () => void; onDesign: () => void; compact?: boolean }) {
  const navReady = useSpectator((s) => s.navReady);
  const building = usePlan((s) => s.plan)!;
  const [config, setConfig] = useState<LabConfig>(DEFAULT_CONFIG);
  const [more, setMore] = useState(false);
  // a seed typed in by hand is kept; otherwise every drill is a new crowd
  const [pinnedSeed, setPinnedSeed] = useState(false);
  const go = (next: LabConfig) => {
    // on a phone or tablet, go full screen and sideways: only allowed from a tap like this one
    void enterLandscape();
    onStart({ ...next, scenarioId: scenario.id, building: building.spec, seed: pinnedSeed ? next.seed : freshSeed() });
  };
  const scenario = building.scenarios.find((s) => s.id === config.scenarioId) ?? building.scenarios[0];
  const playbook = usePlaybook((s) => s.playbook);
  const set = (patch: Partial<LabConfig>) => setConfig((c) => ({ ...c, ...patch }));
  const label = "text-[10px] font-bold uppercase tracking-[0.14em] text-paper/60";

  return (
    <Panel title="Start a drill">
      <label className={label}>Which building?</label>
      <div className="mb-3 mt-1.5 grid grid-cols-3 gap-1">
        <button
          onClick={() => chooseFloor(null)}
          className={`border-2 px-1 py-1.5 text-[11px] font-bold leading-tight ${building.demo ? "border-sun bg-sun/15 text-paper" : "border-paper/15 text-paper/70 hover:border-paper/40"}`}
        >
          Demo campus
        </button>
        <button
          onClick={() => {
            const saved = savedFloor() ?? (building.spec ? building.spec : null);
            if (saved) chooseFloor(saved);
            else onDesign();
          }}
          className={`border-2 px-1 py-1.5 text-[11px] font-bold leading-tight ${!building.demo ? "border-sun bg-sun/15 text-paper" : "border-paper/15 text-paper/70 hover:border-paper/40"}`}
          title={!building.demo ? building.label : "Your own floor"}
        >
          Your floor
        </button>
        <button onClick={onDesign} className="border-2 border-dashed border-paper/30 px-1 py-1.5 text-[11px] font-bold text-paper/70 hover:border-sun hover:text-paper">
          Design
        </button>
      </div>
      <label className={label}>Where does the fire start?</label>
      <div className="mt-1.5 grid grid-cols-2 gap-1">
        {building.scenarios.map((s) => (
          <button
            key={s.id}
            onClick={() => set({ scenarioId: s.id })}
            className={`border-2 px-2 py-1.5 text-left text-[11px] font-bold leading-tight ${scenario.id === s.id ? "border-sun bg-sun/15 text-paper" : "border-paper/15 text-paper/70 hover:border-paper/40"}`}
          >
            {s.label.replace(/^[A-Z][a-z]+ fire in (the )?/, "").replace(/^Fire in (the )?/, "") || s.label}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-paper/55">{scenario.blurb}</p>

      <button onClick={() => go(config)} disabled={!navReady} className="brutal-button mt-3 w-full px-4 py-3 disabled:opacity-60">
        {navReady ? "Sound the alarm" : "Preparing the building…"}
      </button>
      <button
        onClick={() => go({ ...config, warden: "human" })}
        disabled={!navReady}
        className="mt-2 w-full text-center text-[11px] font-bold text-paper/60 underline underline-offset-4 hover:text-paper disabled:opacity-50"
      >
        or be the warden yourself, and see if you beat the AI
      </button>
      <button
        onClick={onAudit}
        className="mt-2 w-full border-2 border-dashed border-[#38bdf8]/60 px-2 py-1.5 text-[11px] font-black uppercase tracking-[0.1em] text-[#38bdf8] hover:border-[#38bdf8]"
      >
        Audit the whole building: every fire
      </button>

      <button onClick={() => setMore((v) => !v)} className="mt-2.5 text-[10px] font-black uppercase tracking-[0.16em] text-paper/50 hover:text-paper" aria-expanded={more}>
        {more ? "− Fewer options" : "+ More options"}
      </button>
      {more && (
        <div className={`mt-2 space-y-3 border-t border-paper/10 pt-3 ${compact ? "grid grid-cols-2 gap-x-4 space-y-0" : ""}`}>
          <div>
            <label className={`flex items-center justify-between ${label}`}>
              People inside <span className="font-mono text-paper">{config.agents}</span>
            </label>
            <input type="range" min={4} max={20} value={config.agents} onChange={(e) => set({ agents: Number(e.target.value) })} className="mt-1 w-full accent-[var(--sun)]" />
          </div>
          <div>
            <div className={label}>Who is the warden?</div>
            <div className="mt-1 grid grid-cols-3 gap-1">
              {(["ai", "human", "none"] as WardenMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => set({ warden: mode })}
                  className={`border-2 px-1 py-1.5 text-[9px] font-black uppercase tracking-wider ${config.warden === mode ? "border-sun bg-sun text-ink" : "border-paper/20 text-paper/70 hover:border-paper/50"}`}
                >
                  {mode === "ai" ? "AI" : mode === "human" ? "You" : "Nobody"}
                </button>
              ))}
            </div>
          </div>
          {config.warden === "ai" && (
            <label className="flex items-center gap-2 text-[11px] text-paper/75">
              <input type="checkbox" checked={config.playbook} onChange={(e) => set({ playbook: e.target.checked })} className="accent-[var(--sun)]" />
              {playbook.rules.length ? `Warden uses what it learned (${playbook.rules.length} rules)` : "Warden uses what it learned (nothing yet)"}
            </label>
          )}
          <label className={`block ${label}`}>
            Seed <span className="normal-case tracking-normal text-paper/40">(blank: new people every drill; a number repeats the same crowd)</span>
            <input
              type="number"
              placeholder="random"
              value={pinnedSeed ? config.seed : ""}
              onChange={(e) => {
                setPinnedSeed(e.target.value !== "");
                set({ seed: Number(e.target.value) || 1 });
              }}
              className="mt-1 w-full border-2 border-paper/25 bg-night px-2 py-1 font-mono text-[12px] text-paper"
            />
          </label>
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ start */

const HOW = [
  { title: "The people are AI", body: "Each one only sees their own room, the signs and the smoke. You can read what they think.", accent: "#38bdf8" },
  { title: "So is the warden", body: "It watches the security camera and speaks over the PA to guide them. You can hear it.", accent: "#ffc44d" },
  { title: "And it learns", body: "After each drill another AI reviews what went wrong, and the warden gets new rules.", accent: "#2fd18f" },
];

/**
 * Where everything starts: watch a drill straight away, or set up your own floor first. Shown
 * whenever no drill is running, so the choice is never hidden behind a menu.
 */
function StartChooser({ onWatch, onDesign, onContinue, onPickFire }: { onWatch: () => void; onDesign: () => void; onContinue: (spec: BuildingSpec) => void; onPickFire: () => void }) {
  const spec = useSavedFloor();
  const saved = useMemo(() => {
    if (!spec) return null;
    const plan = planFor(spec);
    return `${plan.rooms.length - 2} rooms · ${peopleIn(plan)} people`;
  }, [spec]);
  const card = "hud-panel flex flex-col items-start p-4 text-left transition hover:-translate-y-0.5 hover:border-sun";
  return (
    <div className="pointer-events-auto absolute inset-0 z-30 grid place-items-center overflow-y-auto bg-night/60 p-3">
      <section className="w-full max-w-3xl">
        <h1 className="text-center text-2xl font-black uppercase tracking-[-0.03em] sm:text-4xl">Can an AI get a crowd out of a fire?</h1>
        <p className="mx-auto mt-2 max-w-2xl text-center text-[13px] leading-snug text-paper/80">
          Find where an evacuation plan fails, and who it leaves behind, before a real fire does.
        </p>
        <div className={`mt-4 grid gap-2 ${spec ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
          <button onClick={onWatch} className={card} style={{ borderLeftColor: "#ff6a3d" }}>
            <span className="text-[10px] font-black uppercase tracking-[0.16em] text-coral">▶ Just watch</span>
            <span className="mt-1 text-[17px] font-black leading-tight">Watch it happen</span>
            <span className="mt-1 text-[12px] leading-snug text-paper/70">A fire on the demo campus. Twelve AI people, an AI warden. Sit back.</span>
          </button>
          <button onClick={onDesign} className={card} style={{ borderLeftColor: "#ffc44d" }}>
            <span className="text-[10px] font-black uppercase tracking-[0.16em] text-sun">✎ Your building</span>
            <span className="mt-1 text-[17px] font-black leading-tight">Set up your own floor</span>
            <span className="mt-1 text-[12px] leading-snug text-paper/70">Enter your rooms and how many people are in each, then test it in a fire.</span>
          </button>
          {spec && (
            <button onClick={() => onContinue(spec)} className={card} style={{ borderLeftColor: "#2fd18f" }}>
              <span className="text-[10px] font-black uppercase tracking-[0.16em] text-mint">↺ Saved</span>
              <span className="mt-1 text-[17px] font-black leading-tight">Continue with your floor</span>
              <span className="mt-1 text-[12px] leading-snug text-paper/70">{saved}</span>
            </button>
          )}
        </div>
        <div className="mt-3 grid gap-1.5 sm:grid-cols-3">
          {HOW.map((item) => (
            <p key={item.title} className="border-l-2 pl-2 text-[11px] leading-snug text-paper/60" style={{ borderLeftColor: item.accent }}>
              <b className="text-paper/85">{item.title}.</b> {item.body}
            </p>
          ))}
        </div>
        <div className="mt-3 text-center">
          <button onClick={onPickFire} className="text-[11px] font-black uppercase tracking-[0.16em] text-paper/60 underline underline-offset-4 hover:text-paper">
            Or pick the fire myself
          </button>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ people */

function People() {
  const agents = useLab((s) => s.snap?.agents ?? []);
  const follow = useSpectator((s) => s.follow);
  return (
    <Panel title="People" right={<span className="font-mono text-[10px] text-paper/50">click to follow</span>} className="max-h-full">
      <ul className="-mr-2 min-h-0 space-y-1.5 overflow-y-auto pr-2">
        {agents.map((agent) => (
          <li key={agent.id}>
            <button
              onClick={() => useSpectator.setState({ follow: follow === agent.id ? null : agent.id })}
              className={`w-full border-l-4 bg-night/50 px-2 py-1.5 text-left transition hover:bg-paper/10 ${follow === agent.id ? "outline outline-1 outline-paper/60" : ""}`}
              style={{ borderLeftColor: agent.color, opacity: agent.status === "inside" ? 1 : 0.6 }}
            >
              <div className="flex items-center justify-between gap-2 text-[11px] font-black">
                <span className="truncate">
                  {agent.persona.icon ? `${agent.persona.icon} ` : ""}#{agent.id} {agent.name} <span className="font-bold text-paper/45">· {agent.persona.label ?? agent.persona.kind}</span>
                </span>
                <span className={`shrink-0 font-mono text-[10px] ${agent.status === "safe" ? "text-mint" : agent.status === "down" ? "text-danger" : "text-paper/60"}`}>
                  {agent.status === "inside" ? `${agent.sheltering ? "sheltering · " : ""}${Math.round(agent.health)}♥ ${placeName(agent.room)}` : agent.status}
                </span>
              </div>
              <div className="mt-0.5 truncate text-[10px] text-paper/70">{agent.deciding ? "thinking…" : agent.action}</div>
              {agent.thought && agent.thought !== "…" && <div className="mt-0.5 line-clamp-2 text-[10px] italic leading-snug text-paper/55">“{agent.thought}”</div>}
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* ------------------------------------------------------------------ warden */

const QUICK_PHRASES = [
  "Everyone: leave by the nearest green FIRE EXIT.",
  "Do not use the Central Corridor.",
  "Library: use the FIRE EXIT on the west wall.",
  "Cafeteria: use the FIRE EXIT on the east wall.",
  "If every way out is smoky: shut the door, stay low by a window and wait.",
];

function Warden({ mode }: { mode: WardenMode }) {
  const turns = useLab((s) => s.snap?.warden ?? []);
  const busy = useLab((s) => s.snap?.wardenBusy ?? false);
  const log = useLab((s) => s.snap?.log ?? []);
  const [enlarged, setEnlarged] = useState(false);
  const [draft, setDraft] = useState("");
  const latest = [...turns].reverse().find((turn) => turn.image);
  const announcements = log.filter((entry) => entry.kind === "warden" || entry.kind === "human").slice(0, 14);

  return (
    <Panel title={WARDEN_LABEL[mode]} right={busy ? <span className="signal-pulse font-mono text-[10px] text-sun">looking…</span> : null} className="max-h-full">
      <div className="-mr-2 min-h-0 space-y-2 overflow-y-auto pr-2">
        {mode === "ai" && (
          <>
            {lab.orders && (
              <details className="border-l-2 border-sun bg-night/50 px-2 py-1 text-[10px] text-paper/70">
                <summary className="cursor-pointer font-bold uppercase tracking-wider text-sun">Standing orders · playbook v{lab.playbookVersion}</summary>
                <pre className="mt-1 whitespace-pre-wrap font-sans text-[11px] leading-snug">{lab.orders.split("\n").slice(1).join("\n")}</pre>
              </details>
            )}
            {latest ? (
              <button onClick={() => setEnlarged(true)} className="block w-full" title="What the warden saw">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={latest.image!} alt={`CCTV frame at ${Math.round(latest.t)} seconds`} className="w-full border border-paper/20" />
                <span className="mt-0.5 block text-left font-mono text-[9px] text-paper/45">
                  CCTV frame the warden saw at {clock(latest.t)} · {latest.ms} ms to decide
                </span>
              </button>
            ) : (
              <p className="text-[11px] text-paper/50">The warden takes its first look a few seconds after the alarm.</p>
            )}
            {latest && (
              <details className="text-[10px] text-paper/65">
                <summary className="cursor-pointer font-bold uppercase tracking-wider text-paper/55">What the vision model reported</summary>
                <pre className="mt-1 whitespace-pre-wrap font-mono text-[10px] leading-snug">{latest.report || latest.error}</pre>
              </details>
            )}
            {latest?.reasoning && (
              <details className="text-[10px] text-paper/65">
                <summary className="cursor-pointer font-bold uppercase tracking-wider text-paper/55">How Nemotron Super reasoned</summary>
                <p className="mt-1 whitespace-pre-wrap leading-snug">{latest.reasoning}</p>
              </details>
            )}
            {latest?.assessment && <p className="border-l-2 border-sun pl-2 text-[11px] italic text-paper/75">{latest.assessment}</p>}
          </>
        )}

        {mode === "human" && (
          <>
          <p className="text-[11px] leading-snug text-paper/60">
            You are the warden. Watch the building and tell people where to go. They only know their own room, so name rooms and signs.
          </p>
          <div className="flex flex-wrap gap-1">
            {QUICK_PHRASES.map((phrase) => (
              <button
                key={phrase}
                type="button"
                onClick={() => setDraft(phrase)}
                className="border border-paper/25 px-1.5 py-0.5 text-left text-[10px] text-paper/75 hover:border-sun hover:text-paper"
              >
                {phrase}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!draft.trim()) return;
              humanBroadcast(draft);
              setDraft("");
            }}
            className="flex gap-1.5"
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Announce to everyone, e.g. Library: use the west fire exit"
              className="min-w-0 flex-1 border-2 border-paper/25 bg-night px-2 py-1.5 text-[12px] text-paper placeholder:text-paper/35"
            />
            <button className="brutal-button shrink-0 px-3 py-1.5 text-[11px]">Send</button>
          </form>
          </>
        )}

        {mode === "none" && <p className="text-[11px] text-paper/55">Nobody is coordinating. The people only have the signs, the smoke and each other.</p>}

        <div>
          <div className="mb-1 text-[9px] font-black uppercase tracking-[0.18em] text-paper/45">Announcements</div>
          {announcements.length ? (
            <ul className="space-y-1">
              {announcements.map((entry, i) => (
                <li key={i} className="text-[11px] leading-snug">
                  <span className="mr-1.5 font-mono text-[10px] text-paper/40">{clock(entry.t)}</span>
                  {entry.text}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-paper/40">None yet.</p>
          )}
        </div>
      </div>

      {/* portalled: the panel's backdrop blur would otherwise trap a fixed overlay inside it */}
      {enlarged &&
        latest &&
        createPortal(
          <button onClick={() => setEnlarged(false)} className="fixed inset-0 z-50 grid place-items-center bg-night/90 p-6" aria-label="Close">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={latest.image!} alt="CCTV frame" className="max-h-full max-w-full border-2 border-paper/30" />
          </button>,
          document.body,
        )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ top bar */

function Stats({ compact = false }: { compact?: boolean }) {
  const snap = useLab((s) => s.snap);
  if (!snap) return null;
  const safe = snap.agents.filter((a) => a.status === "safe").length + snap.crowd.safe;
  const down = snap.agents.filter((a) => a.status === "down").length + snap.crowd.down;
  const inside = snap.agents.length + snap.crowd.total - safe - down;
  const avg = snap.usage.calls ? Math.round(snap.usage.ms / Math.max(1, snap.usage.calls - snap.usage.failures)) : 0;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px]">
      <span className="text-paper">{clock(snap.t)}<span className="text-paper/40"> / {clock(MAX_RUN_SECONDS)}</span></span>
      <span className="text-mint">{safe} out</span>
      <span className="text-paper/80">{inside} inside</span>
      <span className="text-danger">{down} down</span>
      <span className={compact ? "hidden" : "text-paper/55"} title="model calls this run">{snap.usage.calls} calls{snap.usage.failures ? ` (${snap.usage.failures} failed)` : ""} · {avg} ms avg</span>
      <span className={snap.usage.cost > RUN_BUDGET_USD * 0.8 ? "text-danger" : "text-sun"} title={`this run stops calling models at $${RUN_BUDGET_USD}`}>
        ${snap.usage.cost.toFixed(3)}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ results */

/** The best AI-warden result on exactly this fire and these people, from saved runs. */
function bestAi(result: RunResult) {
  return readExperiments()
    .filter((r) => r.warden === "ai" && r.scenario === result.scenario && r.seed === result.seed && r.agents === result.agents)
    .sort((a, b) => b.safe + (b.sheltered ?? 0) - (a.safe + (a.sheltered ?? 0)))[0];
}

function Results({ onAgain, onSetup, onCompare, onWatch }: { onAgain: () => void; onSetup: () => void; onCompare: () => void; onWatch: () => void }) {
  // mounted once per finished run (keyed by run), so the summary is taken and saved exactly once
  const [result] = useState<RunResult | null>(() => {
    const summary = summarise();
    if (summary) saveExperiment(summary);
    return summary;
  });
  const [failedFor] = useState(findings);
  const [checks] = useState(() => auditDrill(null));
  const [review, setReview] = useState<Awaited<ReturnType<typeof debrief>> | "loading" | "error" | null>(null);
  const [shown, setShown] = useState(true);

  if (!result || !shown) return null;
  return (
    <div className="pointer-events-auto absolute inset-0 z-40 grid place-items-center bg-night/70 p-4">
      <section className="brutal-panel-dark max-h-full w-full max-w-2xl overflow-y-auto p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="brutal-tag bg-sun text-ink">Run complete</span>
            <h2 className="mt-2 text-2xl font-black uppercase tracking-[-0.03em]">
              {result.safe + result.sheltered}/{result.agents} survived
            </h2>
            <p className="text-[12px] text-paper/60">
              {result.scenario} · {WARDEN_LABEL[result.warden]} · seed {result.seed}
            </p>
          </div>
          <button onClick={() => setShown(false)} className="text-[11px] font-bold uppercase text-paper/50 hover:text-paper">Close</button>
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {[
            ["Out", result.safe],
            ["Sheltered", result.sheltered],
            ["Down", result.down],
            ["Avg time out", result.meanEscape === null ? "–" : `${result.meanEscape}s`],
            ["Smoke dose", result.meanExposure],
            ["Cost", `$${result.cost.toFixed(3)}`],
          ].map(([label, value]) => (
            <div key={label} className="border border-paper/15 bg-night/60 p-2">
              <dt className="text-[9px] font-black uppercase tracking-[0.14em] text-paper/45">{label}</dt>
              <dd className="mt-0.5 font-mono text-lg font-black">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-[11px] text-paper/55">
          Exits used: {Object.entries(result.exits).map(([exit, n]) => `${exit} ${n}`).join(" · ") || "none"} · {result.announcements} announcements · {result.calls} model calls
        </p>

        {checks && (
          <div className="mt-4 border-t border-paper/15 pt-4">
            <ScorecardView drills={[checks]} compact />
          </div>
        )}

        <div className="mt-4 border-t border-paper/15 pt-4">
          <h3 className="text-[11px] font-black uppercase tracking-[0.16em] text-danger">Who this plan failed</h3>
          {failedFor.length ? (
            <ul className="mt-2 space-y-1.5">
              {failedFor.slice(0, 6).map((f) => (
                <li key={f.id} className="border-l-4 bg-night/50 px-2.5 py-1.5" style={{ borderLeftColor: f.failed ? "#ef4444" : "#facc15" }}>
                  <div className="text-[12px] font-black">
                    {f.icon} #{f.id} {f.name} <span className="font-bold text-paper/55">· {f.label}</span>
                  </div>
                  <div className={`text-[11px] ${f.failed ? "text-danger" : "text-paper/75"}`}>{f.outcome}</div>
                  {f.trouble.length > 0 && <div className="text-[11px] leading-snug text-paper/60">{f.trouble.join(" · ")}</div>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[12px] text-mint">Nobody. Everyone, including the people most at risk, got out without trouble.</p>
          )}
        </div>

        <div className="mt-4 border-t border-paper/15 pt-4">
          {review === null && (
            <button
              onClick={async () => {
                setReview("loading");
                try {
                  setReview(await debrief());
                } catch {
                  setReview("error");
                }
              }}
              className="brutal-button-dark w-full px-4 py-2.5"
            >
              Debrief this run with {MODELS.debrief.label}
            </button>
          )}
          {review === "loading" && <p className="signal-pulse text-[12px] text-sun">{MODELS.debrief.label} is reading the whole run…</p>}
          {review === "error" && <p className="text-[12px] text-danger">The debrief could not be generated. Try again.</p>}
          {review && typeof review === "object" && (
            <div className="space-y-2 text-[12px] leading-snug">
              <p className="text-[14px] font-black">
                {review.verdict} <span className="font-mono text-sun">({review.coordination_score}/10)</span>
              </p>
              {review.what_worked?.length ? <p><b className="text-mint">Worked:</b> {review.what_worked.join(" · ")}</p> : null}
              {review.what_failed?.length ? <p><b className="text-danger">Failed:</b> {review.what_failed.join(" · ")}</p> : null}
              {review.warden_clarity && <p><b className="text-sun">Announcements:</b> {review.warden_clarity}</p>}
              {review.next_experiment && <p><b className="text-[#a78bfa]">Try next:</b> {review.next_experiment}</p>}
            </div>
          )}
        </div>

        {result.warden === "human" &&
          (() => {
            const ai = bestAi(result);
            const you = result.safe + result.sheltered;
            if (!ai)
              return (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-2 border-sun/60 bg-night/60 p-3">
                  <span className="text-[12px]">How would the AI warden do with the same fire and the same people?</span>
                  <button onClick={onCompare} className="brutal-button px-3 py-2 text-[11px]">Run the AI on this fire</button>
                </div>
              );
            const theirs = ai.safe + (ai.sheltered ?? 0);
            return (
              <div className="mt-4 border-2 border-sun/60 bg-night/60 p-3">
                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-sun">Same fire, same people</div>
                <div className="mt-1 text-[18px] font-black">
                  You saved {you}/{result.agents} · AI warden saved {theirs}/{ai.agents}
                </div>
                <div className="text-[12px] text-paper/60">
                  {you > theirs ? "You beat the AI." : you === theirs ? "A draw." : "The AI did better this time."}
                </div>
              </div>
            );
          })()}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button onClick={onAgain} className="brutal-button px-4 py-2.5">Run again, same seed</button>
          <button onClick={onSetup} className="brutal-button-dark px-4 py-2.5">Change the setup</button>
        </div>
        <button onClick={onWatch} className="mt-2 w-full border-2 border-[#38bdf8] px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.14em] text-[#38bdf8] hover:bg-[#38bdf8] hover:text-ink">
          ▶ Watch this drill again
        </button>
      </section>
    </div>
  );
}

function Experiments({ onClose }: { onClose: () => void }) {
  const [rows] = useState(readExperiments);
  return (
    <div className="pointer-events-auto absolute inset-0 z-40 grid place-items-center bg-night/70 p-4">
      <section className="brutal-panel-dark max-h-full w-full max-w-4xl overflow-y-auto p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-black uppercase">Experiments</h2>
          <button onClick={onClose} className="text-[11px] font-bold uppercase text-paper/50 hover:text-paper">Close</button>
        </div>
        <p className="mt-1 text-[11px] text-paper/55">Every finished run is kept here in this browser. Compare the same seed across warden modes.</p>
        {rows.length ? (
          <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-[11px]">
            <thead className="text-[9px] uppercase tracking-[0.14em] text-paper/45">
              <tr>
                {["Scenario", "Warden", "Seed", "People", "Out", "Down", "Avg out", "Smoke", "Calls", "Cost"].map((h) => (
                  <th key={h} className="py-1 pr-3 font-black">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-paper/10">
                  <td className="py-1 pr-3">{r.scenario}</td>
                  <td className="py-1 pr-3">{r.warden}</td>
                  <td className="py-1 pr-3 font-mono">{r.seed}</td>
                  <td className="py-1 pr-3 font-mono">{r.agents}</td>
                  <td className="py-1 pr-3 font-mono text-mint">{r.safe}</td>
                  <td className="py-1 pr-3 font-mono text-danger">{r.down}</td>
                  <td className="py-1 pr-3 font-mono">{r.meanEscape ?? "–"}s</td>
                  <td className="py-1 pr-3 font-mono">{r.meanExposure}</td>
                  <td className="py-1 pr-3 font-mono">{r.calls}</td>
                  <td className="py-1 pr-3 font-mono">${r.cost.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        ) : (
          <p className="mt-4 text-[12px] text-paper/50">No runs yet.</p>
        )}
      </section>
    </div>
  );
}

function PlaybookBadge() {
  const playbook = usePlaybook((s) => s.playbook);
  const last = usePlaybook((s) => s.history.filter((p) => p.tag === "train").at(-1));
  return (
    <span className="text-[11px] text-paper/75">
      warden knows <b className="text-paper">{playbook.rules.length} rules</b>
      {last && (
        <>
          {" "}· last drill <b className="text-paper">{last.survival}% survived</b>
        </>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ shell */

/** Phones and narrow windows get one drawer instead of two fixed side panels. */
// phones (and small windows) get one drawer; a big tablet held sideways has room for the full layout
const compactQuery = "(max-width: 1099px), (max-height: 620px)";
function useCompact() {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(compactQuery);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(compactQuery).matches,
    () => false,
  );
}

/** The last few things that happened. Its own component, so the log never re-renders the shell. */
function Ticker({ lines }: { lines: number }) {
  const log = useLab((s) => s.snap?.log);
  if (!log) return null;
  return (
    <ul className="space-y-1">
      {log.slice(0, lines).map((entry, i) => (
        <li key={`${entry.t}-${i}`} className="truncate bg-night/80 px-2 py-1 text-[11px]" style={{ opacity: lines > 6 ? 1 : 1 - i * 0.2 }}>
          <span className="mr-1.5 font-mono text-[10px] text-paper/40">{clock(entry.t)}</span>
          <span className={entry.kind === "warden" || entry.kind === "human" ? "text-sun" : entry.kind === "system" ? "text-paper/60" : "text-paper"}>{entry.text}</span>
        </li>
      ))}
    </ul>
  );
}


const barButton = "whitespace-nowrap border-2 border-paper/30 bg-night/85 px-2.5 py-1.5 text-[10px] font-black uppercase tracking-[0.12em] hover:border-paper/70";
const pauseRun = () => setRunning(false);

export default function CrowdLab() {
  const hasRun = useLab((s) => !!s.snap);
  const running = useLab((s) => s.snap?.running ?? false);
  const finished = useLab((s) => s.snap?.finished ?? false);
  const compact = useCompact();
  const [config, setConfig] = useState<LabConfig | null>(null);
  const [showExperiments, setShowExperiments] = useState(false);
  const [drawer, setDrawer] = useState<"people" | "warden" | "log" | null>(null);
  const [showTraining, setShowTraining] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [showDesigner, setShowDesigner] = useState(false);
  // the simple view is the default; the panels with every detail are one click away
  const [details, setDetails] = useState(false);
  const story = useStory();
  // the start screen, every time no drill is running
  const [choosing, setChoosing] = useState(true);
  // a queue of drills run back to back: training (learning on) or the before/after evaluation
  const [queue, setQueue] = useState<{ items: QueueItem[]; index: number; label: string } | null>(null);
  const handled = useRef(-1);
  const queueRef = useRef(queue);
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);
  const [reviewing, setReviewing] = useState(false);
  // a recorded drill being watched, and how fast
  const [watching, setWatching] = useState<{ replay: Replay; label: string } | null>(null);
  const [speed, setSpeed] = useState(1);
  const savedRun = useRef(-1);
  // the drill that closed a queue: its results live in the training panel, not a pop-up
  const [quietRun, setQuietRun] = useState(-1);
  // what the last training drill taught the warden, shown while the next one starts
  const [lesson, setLesson] = useState<{ drill: number; survival: number; added: string[]; removed: string[] } | null>(null);
  const started = hasRun && !!config;


  useEffect(() => {
    void hydratePlaybook();
  }, []);

  useEffect(() => {
    if (!hasRun || finished) return;
    if (running) resumeVoice();
    else pauseVoice();
  }, [running, finished, hasRun]);

  useEffect(() => () => stopSpeaking(), []);

  const start = (next: LabConfig) => {
    stopSpeaking();
    setVoiceRate(1);
    setWatching(null);
    lab.speed = 1;
    setConfig(next);
    setDrawer(next.warden === "human" ? "warden" : null);
    useSpectator.setState({ follow: null });
    setupRun(next);
    setRunning(true);
  };
  /** "Watch it happen": a drill on the demo campus, as soon as it is ready to run. */
  const watchDemo = () => {
    const go = () => start({ ...DEFAULT_CONFIG, scenarioId: DEMO_PLAN.scenarios[0].id, seed: freshSeed() });
    if (usePlan.getState().plan.demo && useSpectator.getState().navReady) return go();
    chooseFloor(null);
    // the campus is being built: start the moment its walking map is read
    const stop = useSpectator.subscribe((state) => {
      if (!state.navReady || !usePlan.getState().plan.demo) return;
      stop();
      go();
    });
  };
  const newSetup = () => {
    stopSpeaking();
    setVoiceRate(1);
    setWatching(null);
    lab.speed = 1;
    setRunning(false);
    setConfig(null);
    setQueue(null);
    setChoosing(true);
    useLab.setState({ snap: null });
  };

  const lastReplay = useRef<Replay | null>(null);

  const playRecorded = (replay: Replay, label: string) => {
    stopSpeaking();
    setVoiceRate(1);
    setShowTraining(false);
    setShowAudit(false);
    setQueue(null);
    setConfig(replay.config);
    setDrawer(null);
    setSpeed(1);
    lab.speed = 1;
    setWatching({ replay, label });
    useSpectator.setState({ follow: null });
    playReplay(replay);
  };

  const watch = async (drill: number) => {
    const replay = await findReplay(drill);
    if (!replay) {
      window.alert("That drill was not recorded in this browser.");
      return;
    }
    playRecorded(replay, `Training drill ${drill}`);
  };

  // a drill run by hand is kept as a replay too
  useEffect(() => {
    if (!finished || queue || lab.playback || savedRun.current === lab.runId) return;
    savedRun.current = lab.runId;
    const replay = takeReplay(null);
    lastReplay.current = replay;
    if (replay) void saveReplay(replay);
  }, [finished, queue]);

  const runQueue = (items: QueueItem[], label: string) => {
    setShowTraining(false);
    setShowAudit(false);
    setQueue({ items, index: 0, label });
    start(items[0].config);
  };

  // when a queued drill ends: review it (and let the review rewrite the playbook when
  // training), record the point on the curve, then start the next drill
  useEffect(() => {
    if (!finished || !queue || handled.current === lab.runId) return;
    handled.current = lab.runId;
    const item = queue.items[queue.index];
    // the queue's next drill, or its end and the panel that shows what it found
    const advance = () => {
      const next = queue.index + 1;
      if (next >= queue.items.length) {
        setQuietRun(lab.runId);
        setQueue(null);
        if (item.tag === "audit") setShowAudit(true);
        else setShowTraining(true);
        return;
      }
      setQueue({ ...queue, index: next });
      // a Stop pressed during the pause between drills must win
      window.setTimeout(() => queueRef.current && start(queue.items[next].config), 1200);
    };
    if (item.tag === "audit") {
      // an audit only records what happened; no review, no learning, nothing to wait for
      const replay = takeReplay(null);
      savedRun.current = lab.runId;
      if (replay) void saveReplay(replay);
      const drill = auditDrill(replay?.id ?? null);
      if (drill) recordAuditDrill(drill);
      advance();
      return;
    }
    const tag = item.tag;
    void (async () => {
      const drill = nextDrillNumber();
      const replay = takeReplay(item.learn ? drill : null);
      savedRun.current = lab.runId;
      if (replay) {
        void saveReplay(replay);
        if (item.learn && usePlaybook.getState().storage === "shared") void shareReplay(replay, adminKey());
      }
      setReviewing(true);
      const review = await debrief(item.learn).catch(() => null);
      setReviewing(false);
      // stopped while the review was running: leave the lab as it is
      if (queueRef.current !== queue) return;
      const summary = summarise();
      if (summary) {
        saveExperiment(summary);
        recordPoint({
          drill,
          at: Date.now(),
          tag,
          scenarioId: item.config.scenarioId,
          scenario: summary.scenario,
          seed: summary.seed,
          playbookVersion: summary.playbookVersion,
          rules: lab.ruleCount,
          survival: Math.round((100 * (summary.safe + summary.sheltered)) / Math.max(1, summary.agents)),
          exposure: summary.meanExposure,
          meanEscape: summary.meanEscape,
          score: typeof review?.coordination_score === "number" ? review.coordination_score : null,
          cost: Math.round(lab.usage.cost * 10000) / 10000,
          change: review?.change,
        });
      }
      if (item.learn && review?.change && summary) {
        const shown = { drill, survival: Math.round((100 * (summary.safe + summary.sheltered)) / Math.max(1, summary.agents)), added: review.change.added, removed: review.change.removed };
        setLesson(shown);
        speak(
          shown.added.length
            ? `Drill ${drill} is done. The warden learned a new rule: ${shown.added[0]}`
            : `Drill ${drill} is done. The warden's rules held up.`,
          "narrator",
        );
        window.setTimeout(() => setLesson((current) => (current === shown ? null : current)), 9000);
      }
      advance();
    })();
  }, [finished, queue]);

  return (
    <div className="drill-surface absolute inset-0 overflow-hidden bg-night text-paper">
      <CrowdScene />

      {/* top bar */}
      <header
        className={`safe-top pointer-events-none absolute inset-x-0 top-0 z-10 items-center gap-3 ${compact ? "flex justify-between px-2 py-2" : "grid grid-cols-[1fr_auto_1fr] px-4 py-3"}`}
      >
        <div className="pointer-events-auto flex min-w-0 items-center gap-2.5">
          <Link href="/" className="grid h-7 w-7 shrink-0 place-items-center border-2 border-ink bg-coral text-[10px] font-black text-ink shadow-[2px_2px_0_var(--ink)]">
            CE
          </Link>
          {!compact && (
            <div>
              <div className="text-lg font-black leading-none tracking-[-0.03em]">Crowd Lab</div>
              <div className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.18em] text-paper/50">
                AI crowd evacuation · NVIDIA Nemotron on Nebius
              </div>
            </div>
          )}
        </div>
        <div className={`hud-panel pointer-events-auto min-w-0 ${compact ? "px-2 py-1" : "px-3 py-2"}`}>
          {started ? details ? <Stats compact={compact} /> : <Scoreboard /> : <span className="text-[11px] text-paper/60">{compact ? "Crowd Lab" : "AI people, one AI warden, one fire"}</span>}
        </div>
        <div className="pointer-events-auto flex shrink-0 justify-end gap-1.5">
          {started && !finished && (
            <button onClick={() => setRunning(!running)} className={barButton} aria-label={running ? "Pause" : "Resume"}>
              {compact ? (running ? "❚❚" : "▶") : running ? "Pause" : "Resume"}
            </button>
          )}
          <VoiceToggle className={barButton} />
          {started && !compact && (
            <button onClick={() => setDetails((v) => !v)} className={barButton} aria-pressed={details}>
              {details ? "Simple" : "Details"}
            </button>
          )}
          {started && <HeatToggle compact={compact} />}
          {started && (
            <button onClick={newSetup} className={barButton}>
              New
            </button>
          )}
          <button onClick={() => setShowAudit(true)} className={`${barButton} border-[#38bdf8]/70 text-[#38bdf8]`}>
            Audit
          </button>
          <button onClick={() => setShowTraining(true)} className={`${barButton} border-sun/70 text-sun`}>
            Train
          </button>
        </div>
      </header>

      {!started &&
        !choosing &&
        (compact ? (
          <div className="pointer-events-auto absolute inset-0 z-20 grid place-items-center overflow-y-auto bg-night/40 p-3 pt-14">
            <div className="w-full max-w-2xl">
              <Setup onStart={start} onAudit={() => setShowAudit(true)} onDesign={() => setShowDesigner(true)} compact />
            </div>
          </div>
        ) : (
          <aside className="pointer-events-none absolute bottom-4 left-4 top-[4.5rem] z-10 flex w-[19rem] flex-col">
            <Setup onStart={start} onAudit={() => setShowAudit(true)} onDesign={() => setShowDesigner(true)} />
          </aside>
        ))}

      {started && config && !compact && (
        <>
          <aside className="pointer-events-none absolute bottom-4 left-4 top-[4.5rem] z-10 flex w-[19rem] flex-col">
            {details ? <People /> : <ThoughtsFeed />}
          </aside>
          <aside className="pointer-events-none absolute bottom-4 right-4 top-[4.5rem] z-10 flex w-[22rem] flex-col">
            {details ? <Warden mode={config.warden} /> : <OrdersPanel mode={config.warden} />}
          </aside>
          {details && (
            <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 w-[min(34rem,calc(100vw-44rem))] -translate-x-1/2">
              <Ticker lines={4} />
            </div>
          )}
        </>
      )}

      {/* the story of the drill: the warden's announcement, and one plain sentence about what is happening */}
      {started && (
        <div className={`pointer-events-none absolute inset-x-0 z-10 flex flex-col items-center gap-2 px-3 ${compact ? (queue || watching ? "top-[5.5rem]" : "top-12") : queue || watching ? "top-[6.6rem]" : "top-[4.6rem]"}`}>
          <PABanner pa={story.pa} />
          <Caption text={story.caption} />
        </div>
      )}

      {/* compact: one drawer on the right, opened from tabs along the bottom edge */}
      {started && config && compact && (
        <>
          {drawer && (
            <aside className="pointer-events-none absolute bottom-12 right-2 top-12 z-10 flex w-[min(22rem,58vw)] flex-col">
              {drawer === "people" && <ThoughtsFeed />}
              {drawer === "warden" && <OrdersPanel mode={config.warden} />}
              {drawer === "log" && <Warden mode={config.warden} />}
            </aside>
          )}

          <nav className="pointer-events-auto absolute bottom-2 right-2 z-10 flex gap-1">
            {(["people", "warden", "log"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setDrawer((open) => (open === tab ? null : tab))}
                className={`border-2 px-2.5 py-1.5 text-[10px] font-black uppercase tracking-[0.12em] ${drawer === tab ? "border-sun bg-sun text-ink" : "border-paper/30 bg-night/85 text-paper"}`}
                aria-expanded={drawer === tab}
              >
                {tab === "people" ? "Thoughts" : tab === "warden" ? "Orders" : "Details"}
              </button>
            ))}
          </nav>
        </>
      )}

      {watching && (
        <div className={`pointer-events-auto absolute left-1/2 z-20 flex -translate-x-1/2 flex-wrap items-center justify-center gap-2 border-2 border-[#38bdf8] bg-night/90 px-3 py-1.5 ${compact ? "top-12" : "top-[4.2rem]"}`}>
          <span className="text-[11px] font-black uppercase tracking-[0.12em] text-[#38bdf8]">▶ Replay · {watching.label}</span>
          <span className="text-[11px] text-paper/70">
            warden knew {watching.replay.result.playbookVersion ? "its learned rules" : "no rules yet"} · {watching.replay.result.safe + (watching.replay.result.sheltered ?? 0)}/{watching.replay.result.agents} survived
          </span>
          {[1, 2, 4].map((x) => (
            <button
              key={x}
              onClick={() => {
                lab.speed = x;
                setSpeed(x);
                setVoiceRate(x);
              }}
              className={`border px-1.5 text-[10px] font-black ${speed === x ? "border-[#38bdf8] bg-[#38bdf8] text-ink" : "border-paper/30 text-paper/70"}`}
            >
              {x}×
            </button>
          ))}
          {finished && (
            <button onClick={() => playRecorded(watching.replay, watching.label)} className="text-[10px] font-bold uppercase text-paper/70 underline hover:text-paper">
              Watch again
            </button>
          )}
          <button onClick={newSetup} className="text-[10px] font-bold uppercase text-paper/60 hover:text-paper">Exit</button>
        </div>
      )}
      {queue && (
        <div className={`pointer-events-auto absolute left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 border-2 border-sun bg-night/90 px-3 py-1.5 ${compact ? "top-12" : "top-[4.2rem]"}`}>
          <span className="signal-pulse h-2 w-2 rounded-full bg-sun" />
          <span className="text-[11px] font-black uppercase tracking-[0.12em] text-sun">
            {queue.label === "Training drill" ? "Training the warden" : queue.label} · {queue.label === "Proving the fixes" ? `run ${queue.index + 1} of ${queue.items.length}` : queue.items[queue.index].tag === "audit" ? `fire ${queue.index + 1} of ${queue.items.length}` : `drill ${queue.index + 1} of ${queue.items.length}`}
          </span>
          {reviewing && <span className="text-[10px] text-paper/70">Nemotron Ultra is reviewing the drill…</span>}
          <PlaybookBadge />
          <button onClick={newSetup} className="text-[10px] font-bold uppercase text-paper/60 hover:text-paper">Stop</button>
        </div>
      )}
      {lesson && (
        <div className={`pointer-events-none absolute left-1/2 z-20 w-[min(30rem,calc(100vw-1.5rem))] -translate-x-1/2 ${compact ? "top-[5.5rem]" : "top-[7rem]"}`}>
          <div className="hud-rise border-2 border-mint bg-night/95 px-3 py-2 shadow-[4px_4px_0_var(--mint)]">
            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-mint">
              Drill {lesson.drill} taught the warden · {lesson.survival}% survived
            </div>
            {lesson.added.length || lesson.removed.length ? (
              <ul className="mt-1 space-y-0.5 text-[12px] leading-snug">
                {lesson.added.map((rule) => (
                  <li key={`+${rule}`} className="text-paper">+ {rule}</li>
                ))}
                {lesson.removed.map((rule) => (
                  <li key={`-${rule}`} className="text-paper/45 line-through">− {rule}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-[12px] text-paper/70">No change: its rules held up.</p>
            )}
          </div>
        </div>
      )}
      {config && finished && !queue && !watching && lab.runId !== quietRun && <Results key={lab.runId} onAgain={() => start({ ...config })} onSetup={newSetup} onCompare={() => start({ ...config, warden: "ai" })} onWatch={() => lastReplay.current && playRecorded(lastReplay.current, "Your last drill")} />}
      {choosing && !started && (
        <StartChooser
          onWatch={() => {
            setChoosing(false);
            void enterLandscape();
            watchDemo();
          }}
          onDesign={() => {
            setChoosing(false);
            setShowDesigner(true);
          }}
          onContinue={(spec) => {
            chooseFloor(spec);
            setChoosing(false);
          }}
          onPickFire={() => {
            chooseFloor(null);
            setChoosing(false);
          }}
        />
      )}
      {showTraining && (
        <TrainingPanel
          busy={!!queue}
          onClose={() => setShowTraining(false)}
          onRun={runQueue}
          onWatch={watch}
          onWatchReplay={playRecorded}
          onExperiments={() => {
            setShowTraining(false);
            setShowExperiments(true);
          }}
        />
      )}
      {showExperiments && <Experiments onClose={() => setShowExperiments(false)} />}
      {showDesigner && (
        <FloorDesigner
          onClose={() => setShowDesigner(false)}
          onUse={(spec) => {
            chooseFloor(spec);
            setShowDesigner(false);
          }}
        />
      )}
      {showAudit && (
        <AuditPanel
          busy={!!queue}
          onClose={() => setShowAudit(false)}
          onRun={() => runQueue(beginAudit(freshSeed()), "Building audit")}
          onProve={(fixes) => runQueue(beginTrial(fixes), "Proving the fixes")}
          onWatch={async (id, label) => {
            const replay = await replayById(id);
            if (replay) playRecorded(replay, label);
            else window.alert("That drill is no longer stored in this browser.");
          }}
        />
      )}
      <PortraitBlock onBlock={pauseRun} />
    </div>
  );
}

/** Show or hide the "where people got stuck" heatmap on the floor. */
function HeatToggle({ compact }: { compact: boolean }) {
  const on = useSpectator((s) => s.heat);
  return (
    <button
      onClick={() => useSpectator.setState({ heat: !on })}
      aria-pressed={on}
      title="Where people stood still inside, and where anyone collapsed"
      className={`${barButton} border-[#fb923c]/70 text-[#fb923c]`}
      style={on ? { background: "#fb923c", color: "#16111e" } : undefined}
    >
      {compact ? "Heat" : "Heatmap"}
    </button>
  );
}

/** Pause the run when the tab is hidden: the simulation keeps real time and the models cost money. */
export function usePauseWhenHidden() {
  useEffect(() => {
    let pausedByHiding = false;
    const onHide = () => {
      if (!document.hidden && pausedByHiding) {
        pausedByHiding = false;
        if (!lab.finished) setRunning(true);
        return;
      }
      if (document.hidden && lab.running) {
        pausedByHiding = true;
        setRunning(false);
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);
}
