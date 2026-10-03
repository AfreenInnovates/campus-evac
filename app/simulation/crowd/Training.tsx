"use client";

import { useEffect, useState } from "react";
import type { LabConfig } from "./engine";
import { MAX_RULES, resetTraining, unlockTraining, usePlaybook, type PointTag, type TrainingPoint } from "./playbook";
import { placeName } from "./world";
import { listReplays, type Replay } from "./replay";
import { plan, SCENARIOS } from "./world";

/**
 * Training the warden, and seeing it improve.
 *
 * By default every training drill is the same fire with the same people in the same places,
 * so drill 1 and drill 6 are directly comparable: the only thing that changed is what the
 * warden learned. Rotating the fire is there for testing whether the rules generalise.
 */

export interface QueueItem {
  config: LabConfig;
  /** "audit": one fire of a building audit, recorded for the audit report, not the learning curve */
  tag: PointTag | "audit";
  learn: boolean;
}

export interface TrainingSetup {
  drills: number;
  scenarioId: string | "rotate";
  samePeople: boolean;
}

export const DEFAULT_TRAINING: TrainingSetup = { drills: 5, scenarioId: "corridor", samePeople: true };

export function trainingPlan(setup: TrainingSetup, people = 12): QueueItem[] {
  return Array.from({ length: setup.drills }, (_, i) => ({
    config: {
      scenarioId: setup.scenarioId === "rotate" ? SCENARIOS[i % SCENARIOS.length].id : setup.scenarioId,
      agents: people,
      warden: "ai",
      seed: setup.samePeople ? 7 : 7 + i * 13,
      wardenEvery: 12,
      playbook: true,
      // training runs in whichever building is in use
      building: plan.spec,
    },
    tag: "train",
    learn: true,
  }));
}

/* ------------------------------------------------------------------ chart */

function LearningCurve({ points }: { points: TrainingPoint[] }) {
  const W = 560;
  const H = 190;
  const pad = { l: 34, r: 12, t: 12, b: 26 };
  const x = (i: number) => pad.l + (points.length <= 1 ? 0.5 : i / (points.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / 100) * (H - pad.t - pad.b);
  const line = (values: (number | null)[]) =>
    values
      .map((v, i) => (v === null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`))
      .filter(Boolean)
      .join(" ");
  const survival = points.map((p) => p.survival);
  const score = points.map((p) => (p.score === null ? null : p.score * 10));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Survival and coordination score across training drills">
      {[0, 25, 50, 75, 100].map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="rgba(248,242,234,0.1)" />
          <text x={pad.l - 6} y={y(v)} textAnchor="end" dominantBaseline="middle" fontSize="9" fill="rgba(248,242,234,0.45)">
            {v}
          </text>
        </g>
      ))}
      {points.map((p, i) => (
        <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="9" fill="rgba(248,242,234,0.45)">
          {p.drill}
        </text>
      ))}
      <polyline points={line(survival)} fill="none" stroke="var(--mint)" strokeWidth="2.5" />
      <polyline points={line(score)} fill="none" stroke="var(--sun)" strokeWidth="2" strokeDasharray="5 4" />
      {points.map((p, i) => (
        <g key={`d${i}`}>
          <circle cx={x(i)} cy={y(p.survival)} r="3.5" fill="var(--mint)">
            <title>{`Drill ${p.drill}: ${p.scenario} — ${p.survival}% survived, playbook v${p.playbookVersion} (${p.rules} rules)`}</title>
          </circle>
          {p.score !== null && <circle cx={x(i)} cy={y(p.score * 10)} r="3" fill="var(--sun)" />}
        </g>
      ))}
    </svg>
  );
}

/* ------------------------------------------------------------------ first vs latest */

/** The first and the latest training drill on the same fire, side by side. */
function FirstVsLatest({ points, onWatch }: { points: TrainingPoint[]; onWatch: (drill: number) => void }) {
  const latest = points[points.length - 1];
  const first = latest ? points.find((p) => p.scenarioId === latest.scenarioId && p.seed === latest.seed) : undefined;
  if (!latest || !first || first === latest) return <p className="text-[11px] text-paper/50">After two drills on the same fire, the first and the latest appear here side by side.</p>;
  const card = (label: string, p: TrainingPoint) => (
    <div className="border border-paper/15 bg-night/60 p-2.5">
      <div className="text-[9px] font-black uppercase tracking-[0.14em] text-paper/45">
        {label} · drill {p.drill} · {p.rules} rules
      </div>
      <div className="mt-1 font-mono text-[22px] font-black" style={{ color: p.survival >= 75 ? "var(--mint)" : p.survival >= 50 ? "var(--sun)" : "var(--danger)" }}>
        {p.survival}%
      </div>
      <div className="text-[10px] text-paper/55">
        survived · smoke dose {p.exposure}
        {p.score !== null ? ` · coordination ${p.score}/10` : ""}
      </div>
      <button onClick={() => onWatch(p.drill)} className="mt-2 border-2 border-[#38bdf8] px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-[#38bdf8] hover:bg-[#38bdf8] hover:text-ink">
        ▶ Watch drill {p.drill}
      </button>
    </div>
  );
  return (
    <div>
      <p className="text-[11px] text-paper/55">Same fire, same people. The only difference is what the warden learned.</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {card("First", first)}
        {card("Latest", latest)}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ recordings */

/** Every recorded drill in this browser, newest first, one click to watch. */
function RecordedDrills({ onWatch }: { onWatch: (replay: Replay, label: string) => void }) {
  const [replays, setReplays] = useState<Replay[] | null>(null);
  useEffect(() => {
    let live = true;
    void listReplays().then((all) => live && setReplays(all));
    return () => {
      live = false;
    };
  }, []);
  if (!replays) return null;
  return (
    <div className="border-2 border-[#38bdf8]/60 bg-night/60 p-3">
      <div className="text-[11px] font-black uppercase tracking-[0.16em] text-[#38bdf8]">▶ Recorded drills · watch any of them again</div>
      {replays.length ? (
        <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto pr-1">
          {replays.map((replay) => {
            const label = replay.drill !== null ? `Training drill ${replay.drill}` : replay.config.warden === "human" ? "Your drill as warden" : "Drill";
            const survived = replay.result.safe + (replay.result.sheltered ?? 0);
            return (
              <li key={replay.id} className="flex items-center justify-between gap-2 border-b border-paper/10 pb-1 text-[12px]">
                <span className="min-w-0 truncate">
                  <b>{label}</b>
                  <span className="text-paper/55">
                    {" "}
                    · {replay.result.scenario} · {survived}/{replay.result.agents} survived · {new Date(replay.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </span>
                <button onClick={() => onWatch(replay, label)} className="shrink-0 border-2 border-[#38bdf8] px-2 py-0.5 text-[10px] font-black uppercase text-[#38bdf8] hover:bg-[#38bdf8] hover:text-ink">
                  ▶ Watch
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-1.5 text-[12px] text-paper/55">Nothing recorded in this browser yet. Every drill you run here is recorded automatically.</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ lessons */

/** What each training drill taught the warden, newest first. */
function Lessons({ points, onWatch }: { points: TrainingPoint[]; onWatch: (drill: number) => void }) {
  const lessons = points.filter((p) => p.change && (p.change.added.length || p.change.removed.length)).reverse();
  if (!lessons.length) return null;
  return (
    <div className="mt-3">
      <div className="text-[10px] font-black uppercase tracking-[0.16em] text-paper/55">What it learned, drill by drill</div>
      <ol className="mt-1.5 max-h-48 space-y-2 overflow-y-auto pr-1">
        {lessons.map((p) => (
          <li key={`${p.drill}-${p.at}`} className="border-l-2 border-paper/20 pl-2 text-[11px] leading-snug">
            <div className="flex items-center justify-between gap-2 font-mono text-[9px] uppercase text-paper/45">
              <span>
                Drill {p.drill} · {p.survival}% survived
              </span>
              <button onClick={() => onWatch(p.drill)} className="font-black text-[#38bdf8] hover:underline">
                ▶ Watch
              </button>
            </div>
            {p.change!.added.map((rule) => (
              <div key={`+${rule}`} className="text-mint">+ {rule}</div>
            ))}
            {p.change!.removed.map((rule) => (
              <div key={`-${rule}`} className="text-paper/40 line-through">− {rule}</div>
            ))}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Asks for the owner key once, only when the shared warden is locked. */
function Unlock() {
  const [key, setKey] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (key.trim()) unlockTraining(key);
      }}
      className="mt-4 flex flex-wrap items-center gap-2 border border-sun/40 bg-night/60 p-2.5"
    >
      <span className="text-[11px] text-paper/70">Only the lab owner can train the shared warden.</span>
      <input
        type="password"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder="Owner key"
        className="min-w-0 flex-1 border-2 border-paper/25 bg-night px-2 py-1 text-[12px] text-paper"
      />
      <button className="brutal-button px-3 py-1.5 text-[11px]">Unlock</button>
    </form>
  );
}

/* ------------------------------------------------------------------ panel */

export default function TrainingPanel({
  onClose,
  onRun,
  onWatch,
  onWatchReplay,
  onExperiments,
  busy,
}: {
  onClose: () => void;
  onRun: (items: QueueItem[], label: string) => void;
  onWatch: (drill: number) => void;
  onWatchReplay: (replay: Replay, label: string) => void;
  onExperiments: () => void;
  busy: boolean;
}) {
  const playbook = usePlaybook((s) => s.playbook);
  const history = usePlaybook((s) => s.history);
  const storage = usePlaybook((s) => s.storage);
  const canTrain = usePlaybook((s) => s.canTrain);
  const train = history.filter((p) => p.tag === "train");
  const [setup, setSetup] = useState<TrainingSetup>(DEFAULT_TRAINING);

  return (
    <div className="pointer-events-auto absolute inset-0 z-40 grid place-items-center bg-night/75 p-3">
      <section className="brutal-panel-dark max-h-full w-full max-w-4xl overflow-y-auto p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="brutal-tag bg-sun text-ink">Warden training</span>
            <h2 className="mt-2 text-xl font-black uppercase tracking-[-0.03em] sm:text-2xl">The warden learns from its own drills</h2>
            <p className="mt-1 max-w-2xl text-[12px] leading-snug text-paper/60">
              After each drill, Nemotron 3 Ultra reviews what happened and rewrites the warden&apos;s rules (at most {MAX_RULES}). The next drill&apos;s warden follows them.
            </p>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-paper/40">
              {storage === "shared" ? "● Shared: everyone sees this warden" : storage === "local" ? "● Saved in this browser only" : "Loading…"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <button onClick={onExperiments} className="text-[11px] font-bold uppercase text-paper/50 underline underline-offset-4 hover:text-paper">All runs</button>
            <button onClick={onClose} className="text-[11px] font-bold uppercase text-paper/50 hover:text-paper">Close</button>
          </div>
        </div>

        <div className="mt-4">
          <RecordedDrills onWatch={onWatchReplay} />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-[0.16em]">
              <span className="text-paper/55">Learning curve · {train.length} drills</span>
              <span className="flex gap-3">
                <span className="text-mint">— survived %</span>
                <span className="text-sun">- - Ultra score ×10</span>
              </span>
            </div>
            <div className="mt-1 border border-paper/15 bg-night/60 p-2">
              {train.length ? <LearningCurve points={train} /> : <p className="p-6 text-center text-[11px] text-paper/45">Run a training session to draw the curve.</p>}
            </div>
            <div className="mt-3">
              <div className="mb-1 text-[10px] font-black uppercase tracking-[0.16em] text-paper/55">First drill vs latest drill</div>
              <FirstVsLatest points={train} onWatch={onWatch} />
            </div>
          </div>

          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-paper/55">
              Playbook v{playbook.version} · {playbook.rules.length}/{MAX_RULES} rules
            </div>
            {playbook.rules.length ? (
              <ol className="mt-1.5 space-y-1.5">
                {playbook.rules.map((rule, i) => (
                  <li key={i} className="border-l-2 border-sun bg-night/60 px-2 py-1.5 text-[12px] leading-snug">
                    {rule.text}
                    <span className="ml-1.5 font-mono text-[9px] text-paper/40">learned in drill {rule.from}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-1.5 text-[11px] text-paper/45">Empty. The warden starts with nothing but the building plan.</p>
            )}
            <Lessons points={train} onWatch={onWatch} />
          </div>
        </div>

        {!canTrain && <Unlock />}
        <div className={`mt-4 border-t border-paper/10 pt-4 ${canTrain ? "" : "pointer-events-none opacity-40"}`}>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-[10px] font-black uppercase tracking-[0.14em] text-paper/55">
              Drills
              <input
                type="number"
                min={1}
                max={20}
                value={setup.drills}
                onChange={(e) => setSetup((v) => ({ ...v, drills: Math.max(1, Math.min(20, Number(e.target.value) || 1)) }))}
                className="mt-1 block w-20 border-2 border-paper/25 bg-night px-2 py-1.5 font-mono text-[13px] text-paper"
              />
            </label>
            <label className="text-[10px] font-black uppercase tracking-[0.14em] text-paper/55">
              Fire
              <select
                value={setup.scenarioId}
                onChange={(e) => setSetup((v) => ({ ...v, scenarioId: e.target.value }))}
                className="mt-1 block border-2 border-paper/25 bg-night px-2 py-1.5 text-[12px] normal-case tracking-normal text-paper"
              >
                {SCENARIOS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {placeName(s.origin)}
                  </option>
                ))}
                <option value="rotate">A different fire each drill</option>
              </select>
            </label>
            <label className="flex items-center gap-2 pb-2 text-[11px] text-paper/70">
              <input type="checkbox" checked={setup.samePeople} onChange={(e) => setSetup((v) => ({ ...v, samePeople: e.target.checked }))} className="accent-[var(--sun)]" />
              Same people every drill
            </label>
          </div>
        </div>
        <div className={`mt-3 grid gap-2 sm:grid-cols-[2fr_1fr] ${canTrain ? "" : "pointer-events-none opacity-40"}`}>
          <button disabled={busy} onClick={() => onRun(trainingPlan(setup), `Training drill`)} className="brutal-button px-3 py-2.5 disabled:opacity-50">
            Train the warden: {setup.drills} {setup.drills === 1 ? "drill" : "drills"} (~${(setup.drills * 0.06).toFixed(2)})
          </button>
          <button
            disabled={busy}
            onClick={() => {
              if (window.confirm("Forget the playbook and the whole training history?")) resetTraining();
            }}
            className="border-2 border-coral px-3 py-2.5 text-[11px] font-black uppercase tracking-[0.14em] text-coral hover:bg-coral hover:text-ink disabled:opacity-40"
          >
            Reset playbook
          </button>
        </div>
        <p className="mt-2 text-[10px] text-paper/45">
          Each drill takes up to 4 minutes. Keep this tab in front: the drill pauses while you are away and carries on when you come back.
        </p>
      </section>
    </div>
  );
}
