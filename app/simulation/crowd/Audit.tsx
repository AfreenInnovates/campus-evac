"use client";

import { useState } from "react";
import { ROOMS, type RoomId } from "../level";
import type { AuditDrill, LabConfig } from "./engine";
import { FIXES, fixById, type FixId } from "./fixes";
import { costOf } from "./prompts";
import type { QueueItem } from "./Training";
import { LINKS, placeName, SCENARIOS } from "./world";

/**
 * The building audit: the same people, the fire started in every room in turn, and one
 * report on where the evacuation plan breaks and who it leaves behind. Then the fix: an AI
 * advisor picks changes from what failed, and the failing fires are rerun with them, same
 * people, same places, to prove whether they work.
 *
 * The numbers are pure functions of the recorded drills (`summariseAudit`); the panel only
 * draws them.
 */

/* ------------------------------------------------------------------ storage */

export interface AuditRun {
  at: number;
  seed: number;
  total: number;
  /** none for the building as it is; the changes under test for a trial */
  fixes: FixId[];
  drills: AuditDrill[];
}

type Which = "baseline" | "trial";
const KEYS: Record<Which, string> = { baseline: "campusevac:audit", trial: "campusevac:audit-trial" };

export function readAudit(which: Which = "baseline"): AuditRun | null {
  try {
    const run = JSON.parse(localStorage.getItem(KEYS[which]) ?? "null") as AuditRun | null;
    return run && { ...run, fixes: run.fixes ?? [] };
  } catch {
    return null;
  }
}

function writeAudit(which: Which, run: AuditRun | null) {
  try {
    if (run) localStorage.setItem(KEYS[which], JSON.stringify(run));
    else localStorage.removeItem(KEYS[which]);
  } catch {
    /* the report still shows for this visit */
  }
}

/** The same crowd through each fire, with the given changes made to the building. */
function drillsFor(seed: number, agents: number, scenarioIds: string[], fixes: FixId[]): QueueItem[] {
  return scenarioIds.map((scenarioId) => ({
    config: { scenarioId, agents, warden: "ai", seed, wardenEvery: 12, playbook: true, fixes } satisfies LabConfig,
    tag: "audit",
    learn: false,
  }));
}

/** Start a fresh audit and return the drills to queue: every fire, the same crowd. */
export function beginAudit(seed: number, agents = 12): QueueItem[] {
  writeAudit("baseline", { at: Date.now(), seed, total: SCENARIOS.length, fixes: [], drills: [] });
  writeAudit("trial", null);
  return drillsFor(seed, agents, SCENARIOS.map((scenario) => scenario.id), []);
}

/** The fires worth rerunning to prove a fix: wherever someone was lost, else wherever anyone had trouble. */
export function firesToProve(run: AuditRun) {
  const lost = run.drills.filter((d) => d.survived < d.agents);
  const troubled = run.drills.filter((d) => d.people.some((p) => p.trouble.length));
  return (lost.length ? lost : troubled.length ? troubled : run.drills).map((d) => d.scenarioId);
}

/** Rerun the failing fires of the last audit with the chosen fixes: same seed, so the same people in the same places. */
export function beginTrial(fixes: FixId[]): QueueItem[] {
  const base = readAudit();
  if (!base) return [];
  const fires = firesToProve(base);
  writeAudit("trial", { at: Date.now(), seed: base.seed, total: fires.length, fixes, drills: [] });
  return drillsFor(base.seed, base.drills[0]?.agents ?? 12, fires, fixes);
}

export function recordAuditDrill(drill: AuditDrill) {
  const which: Which = drill.fixes?.length ? "trial" : "baseline";
  const run = readAudit(which);
  if (run) writeAudit(which, { ...run, drills: [...run.drills.filter((d) => d.scenarioId !== drill.scenarioId), drill] });
}

/* ------------------------------------------------------------------ the numbers */

export interface GroupRisk {
  kind: string;
  label: string;
  icon: string;
  seen: number;
  survived: number;
  meanOut: number | null;
  /** the trouble that came up most often for this kind of person */
  commonTrouble: string | null;
  /** fires this kind of person did not survive */
  lostIn: string[];
}

const pct = (part: number, whole: number) => Math.round((100 * part) / Math.max(1, whole));
const mean = (values: number[]) => (values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null);

export function summariseAudit(run: AuditRun) {
  const drills = [...run.drills].sort((a, b) => pct(a.survived, a.agents) - pct(b.survived, b.agents));
  const people = drills.flatMap((d) => d.people.map((p) => ({ ...p, scenario: d.scenario })));
  const everyoneOut = mean(people.filter((p) => p.status === "safe" && p.endedAt !== null).map((p) => p.endedAt!));

  const groups = new Map<string, typeof people>();
  for (const p of people) groups.set(p.kind, [...(groups.get(p.kind) ?? []), p]);
  const risk: GroupRisk[] = [...groups.entries()]
    .map(([kind, list]) => {
      // the same trouble with different numbers ("froze for 6s", "froze for 9s") counts as one kind
      const troubles = new Map<string, { n: number; example: string }>();
      for (const t of list.flatMap((p) => p.trouble)) {
        const key = t.replace(/\d+/g, "#");
        const seen = troubles.get(key);
        troubles.set(key, { n: (seen?.n ?? 0) + 1, example: seen?.example ?? t });
      }
      const example = [...troubles.values()].sort((a, b) => b.n - a.n)[0]?.example ?? null;
      return {
        kind,
        label: list[0].label,
        icon: list[0].icon,
        seen: list.length,
        survived: list.filter((p) => p.survived).length,
        meanOut: mean(list.filter((p) => p.status === "safe" && p.endedAt !== null).map((p) => p.endedAt!)),
        commonTrouble: example,
        lostIn: [...new Set(list.filter((p) => !p.survived).map((p) => p.scenario))],
      };
    })
    .sort((a, b) => pct(a.survived, a.seen) - pct(b.survived, b.seen) || (b.meanOut ?? 0) - (a.meanOut ?? 0));

  const exits: Record<string, number> = {};
  for (const d of drills) for (const [exit, n] of Object.entries(d.exits)) exits[exit] = (exits[exit] ?? 0) + n;

  const lostAt: Record<string, number> = {};
  for (const p of people) if (!p.survived) lostAt[p.where] = (lostAt[p.where] ?? 0) + 1;

  return {
    drills,
    survived: drills.reduce((n, d) => n + d.survived, 0),
    total: drills.reduce((n, d) => n + d.agents, 0),
    cost: drills.reduce((n, d) => n + d.cost, 0),
    everyoneOut,
    risk,
    exits,
    lostAt,
    byOrigin: new Map<RoomId, AuditDrill>(drills.map((d) => [d.origin, d])),
  };
}

/* ------------------------------------------------------------------ the advisor */

export interface Advice {
  summary: string;
  fixes: { id: FixId; why: string }[];
  beyond: string[];
  cost: number;
}

/** The audit in plain lines, for the advisor to read. */
function describeAudit(report: ReturnType<typeof summariseAudit>) {
  return [
    `Audit: ${report.drills.length} fires, ${report.survived}/${report.total} people survived overall.`,
    "",
    "Each fire (worst first):",
    ...report.drills.map(
      (d) =>
        `- ${d.scenario}: ${d.survived}/${d.agents} survived; exits used ${JSON.stringify(d.exits)}. ${d.people
          .filter((p) => !p.survived || p.trouble.length)
          .map((p) => `${p.label} ${p.survived ? "got out" : `LOST (${p.status} in ${p.where})`}${p.trouble.length ? `: ${p.trouble.join("; ")}` : ""}`)
          .join(" | ")}`,
    ),
    "",
    "By kind of person:",
    ...report.risk.map((g) => `- ${g.label}: ${g.survived}/${g.seen} survived${g.meanOut !== null ? `, mean time out ${g.meanOut}s` : ""}${g.commonTrouble ? `; often: ${g.commonTrouble}` : ""}`),
    `Everyone's mean time out: ${report.everyoneOut ?? "n/a"}s.`,
    "",
    "Fixes available (choose by id):",
    ...FIXES.map((fix) => `- ${fix.id}: ${fix.title}. ${fix.detail} Helps: ${fix.helps}.`),
  ].join("\n");
}

export async function askAdvisor(run: AuditRun): Promise<Advice> {
  const response = await fetch("/api/crowd", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ task: "advise", input: describeAudit(summariseAudit(run)) }),
  });
  const body = (await response.json()) as { json?: { summary?: string; fixes?: { id?: string; why?: string }[]; beyond?: string[] }; error?: string; input?: number; output?: number };
  if (!response.ok || !body.json) throw new Error(body.error ?? "no advice");
  const known = new Set<string>(FIXES.map((fix) => fix.id));
  return {
    summary: String(body.json.summary ?? ""),
    fixes: (body.json.fixes ?? []).filter((f) => known.has(String(f.id))).map((f) => ({ id: f.id as FixId, why: String(f.why ?? "") })),
    beyond: (body.json.beyond ?? []).map(String).slice(0, 3),
    cost: costOf("advise", body.input ?? 0, body.output ?? 0),
  };
}

/* ------------------------------------------------------------------ before and after */

/** The baseline, cut down to the fires the trial reran, against the trial itself. */
export function compareTrial(base: AuditRun, trial: AuditRun) {
  const fires = new Set(trial.drills.map((d) => d.scenarioId));
  const before = summariseAudit({ ...base, drills: base.drills.filter((d) => fires.has(d.scenarioId)) });
  const after = summariseAudit(trial);
  const afterByKind = new Map(after.risk.map((g) => [g.kind, g]));
  return {
    before,
    after,
    fires: before.drills.map((d) => ({ before: d, after: trial.drills.find((t) => t.scenarioId === d.scenarioId)! })),
    groups: before.risk.map((g) => ({ before: g, after: afterByKind.get(g.kind) })),
  };
}

function Delta({ before, after, whole }: { before: number; after: number; whole: number }) {
  const better = after > before;
  const worse = after < before;
  return (
    <span className="font-mono">
      {before}/{whole} → <b className={better ? "text-mint" : worse ? "text-danger" : "text-paper"}>{after}/{whole}</b>
    </span>
  );
}

function BeforeAfter({ base, trial, onWatch }: { base: AuditRun; trial: AuditRun; onWatch: (replayId: string, label: string) => void }) {
  const c = compareTrial(base, trial);
  return (
    <div className="border-2 border-mint/60 bg-night/60 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[11px] font-black uppercase tracking-[0.16em] text-mint">Proof: the same people, the same fires, with the fixes</h3>
        <span className="text-[10px] text-paper/50">
          {trial.drills.length < trial.total ? `${trial.drills.length} of ${trial.total} fires rerun so far` : `${trial.total} fires rerun`}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-paper/60">With: {trial.fixes.map((id) => fixById(id).title).join(" · ")}</p>
      <div className="mt-2 grid gap-3 md:grid-cols-2">
        <div>
          <div className="text-[9px] font-black uppercase tracking-[0.14em] text-paper/45">Survived</div>
          <div className="text-2xl font-black">
            {pct(c.before.survived, c.before.total)}% → <span className="text-mint">{pct(c.after.survived, c.after.total)}%</span>
          </div>
          <ul className="mt-1 space-y-0.5 text-[12px]">
            {c.fires.map(({ before, after }) => (
              <li key={before.scenarioId} className="flex items-center justify-between gap-2">
                <span className="truncate">{before.scenario}</span>
                <span className="flex shrink-0 items-center gap-2">
                  {after ? <Delta before={before.survived} after={after.survived} whole={before.agents} /> : <span className="text-paper/40">pending</span>}
                  {after?.replayId && (
                    <button onClick={() => onWatch(after.replayId!, `${before.scenario}, with fixes`)} className="text-[10px] font-black text-[#38bdf8] underline">
                      watch
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="text-[9px] font-black uppercase tracking-[0.14em] text-paper/45">Who it helped</div>
          <ul className="mt-1 space-y-0.5 text-[12px]">
            {c.groups.map(({ before, after }) => (
              <li key={before.kind} className="flex items-center justify-between gap-2">
                <span className="truncate">
                  {before.icon} {before.label}
                </span>
                {after ? <Delta before={before.survived} after={after.survived} whole={before.seen} /> : <span className="text-paper/40">pending</span>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ fix it */

function FixAndProve({ run, busy, onProve }: { run: AuditRun; busy: boolean; onProve: (fixes: FixId[]) => void }) {
  const [advice, setAdvice] = useState<Advice | "loading" | "error" | null>(null);
  const [chosen, setChosen] = useState<Set<FixId>>(new Set());
  const recommended = advice && typeof advice === "object" ? new Map(advice.fixes.map((f) => [f.id, f.why])) : new Map<FixId, string>();
  const fires = firesToProve(run).length;
  const toggle = (id: FixId) =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="border-2 border-sun/60 bg-night/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[11px] font-black uppercase tracking-[0.16em] text-sun">Fix it, then prove it</h3>
        <button
          onClick={async () => {
            setAdvice("loading");
            try {
              const next = await askAdvisor(run);
              setAdvice(next);
              setChosen(new Set(next.fixes.map((f) => f.id)));
            } catch {
              setAdvice("error");
            }
          }}
          disabled={advice === "loading"}
          className="border-2 border-sun px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.1em] text-sun hover:bg-sun hover:text-ink disabled:opacity-50"
        >
          {advice === "loading" ? "Nemotron Ultra is reading the audit…" : "Ask Nemotron Ultra what to fix"}
        </button>
      </div>
      {advice === "error" && <p className="mt-1 text-[11px] text-danger">The advisor could not answer. Try again, or pick fixes yourself.</p>}
      {advice && typeof advice === "object" && <p className="mt-2 text-[12px] leading-snug text-paper/80">{advice.summary}</p>}

      <ul className="mt-2 grid gap-1.5 md:grid-cols-2">
        {FIXES.map((fix) => (
          <li key={fix.id}>
            <label className={`flex cursor-pointer gap-2 border px-2 py-1.5 text-[12px] ${chosen.has(fix.id) ? "border-sun bg-sun/10" : "border-paper/15"}`}>
              <input type="checkbox" checked={chosen.has(fix.id)} onChange={() => toggle(fix.id)} className="mt-0.5 accent-[var(--sun)]" />
              <span>
                <b>{fix.title}</b>
                <span className="block text-[11px] text-paper/60">
                  {recommended.has(fix.id) ? <span className="text-sun">Recommended: {recommended.get(fix.id)}</span> : `${fix.detail} Helps ${fix.helps}.`}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {advice && typeof advice === "object" && advice.beyond.length > 0 && (
        <p className="mt-2 text-[11px] text-paper/60">
          <b className="text-paper/80">Also worth doing:</b> {advice.beyond.join(" · ")}
        </p>
      )}
      <button onClick={() => onProve([...chosen])} disabled={busy || !chosen.size} className="brutal-button mt-3 px-4 py-2 disabled:opacity-50">
        Prove it: rerun {fires} {fires === 1 ? "fire" : "fires"} with {chosen.size || "no"} {chosen.size === 1 ? "fix" : "fixes"}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ risk map */

const riskColor = (rate: number) => (rate >= 100 ? "#2fd18f" : rate >= 85 ? "#facc15" : rate >= 65 ? "#fb923c" : "#ef4444");
const MAP_ROOMS = ROOMS.filter((room) => room.id !== "outside");

/** The floor plan, north up, each room coloured by how many survived when the fire started there. */
function RiskMap({ byOrigin, exits }: { byOrigin: Map<RoomId, AuditDrill>; exits: Record<string, number> }) {
  return (
    <svg viewBox="-23 -44.5 46 56" className="h-auto max-h-[22rem] w-full" role="img" aria-label="Risk map of the building">
      {MAP_ROOMS.map((room) => {
        const b = room.bounds;
        const drill = byOrigin.get(room.id);
        const rate = drill ? pct(drill.survived, drill.agents) : null;
        const small = b.maxX - b.minX < 5 || b.maxZ - b.minZ < 4.5;
        return (
          <g key={room.id}>
            <rect x={b.minX} y={b.minZ} width={b.maxX - b.minX} height={b.maxZ - b.minZ} fill={rate === null ? "#2a2433" : riskColor(rate)} fillOpacity={rate === null ? 1 : 0.8} stroke="#16111e" strokeWidth={0.3} />
            {!small && (
              <text x={(b.minX + b.maxX) / 2} y={(b.minZ + b.maxZ) / 2} textAnchor="middle" fontSize={1.3} fontWeight={800} fill={rate === null ? "#bdb3c9" : "#16111e"}>
                <tspan x={(b.minX + b.maxX) / 2}>{placeName(room.id)}</tspan>
                {rate !== null && (
                  <tspan x={(b.minX + b.maxX) / 2} dy={1.8} fontSize={1.6}>
                    {drill!.survived}/{drill!.agents}
                  </tspan>
                )}
              </text>
            )}
          </g>
        );
      })}
      {LINKS.filter((link) => link.exit).map((link) => (
        <g key={link.id}>
          <circle cx={link.door[0]} cy={link.door[1]} r={1.2} fill="#16a34a" stroke="#fff" strokeWidth={0.25} />
          <text x={link.door[0]} y={link.door[1] + 0.45} textAnchor="middle" fontSize={1.2} fontWeight={900} fill="#fff">
            {exits[link.exit!] ?? 0}
          </text>
        </g>
      ))}
    </svg>
  );
}

/* ------------------------------------------------------------------ panel */

export default function AuditPanel({
  onClose,
  onRun,
  onProve,
  onWatch,
  busy,
}: {
  onClose: () => void;
  onRun: () => void;
  onProve: (fixes: FixId[]) => void;
  onWatch: (replayId: string, label: string) => void;
  busy: boolean;
}) {
  const [run] = useState(() => readAudit());
  const [trial] = useState(() => readAudit("trial"));
  const report = run && run.drills.length ? summariseAudit(run) : null;
  const worst = report?.drills[0];

  return (
    <div className="pointer-events-auto absolute inset-0 z-40 grid place-items-center bg-night/75 p-3">
      <section className="brutal-panel-dark max-h-full w-full max-w-5xl overflow-y-auto p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="brutal-tag bg-sun text-ink">Building audit</span>
            <h2 className="mt-2 text-xl font-black uppercase leading-tight tracking-[-0.02em] sm:text-2xl">Where does this evacuation plan fail?</h2>
            <p className="mt-1 max-w-2xl text-[12px] leading-snug text-paper/65">
              The same {run?.drills[0]?.agents ?? 12} people, the fire started in every room in turn, the AI warden on duty. One drill per fire, a few minutes
              each.
            </p>
          </div>
          <button onClick={onClose} className="text-[11px] font-bold uppercase text-paper/50 hover:text-paper">Close</button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button onClick={onRun} disabled={busy} className="brutal-button px-4 py-2.5 disabled:opacity-50">
            {report ? "Run a new audit" : "Audit the building"}: {SCENARIOS.length} fires
          </button>
          <span className="text-[11px] text-paper/55">about 15 to 25 minutes · roughly $0.15 to $0.30 of Nebius credit</span>
        </div>

        {!report ? (
          <p className="mt-5 text-[13px] text-paper/60">No audit yet in this browser.</p>
        ) : (
          <>
            {run!.drills.length < run!.total && (
              <p className="mt-3 text-[11px] text-sun">Partial audit: {run!.drills.length} of {run!.total} fires so far.</p>
            )}
            <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.1fr]">
              <div className="border border-paper/15 bg-night/60 p-3">
                <div className="text-[11px] font-black uppercase tracking-[0.14em] text-paper/60">Risk map</div>
                <RiskMap byOrigin={report.byOrigin} exits={report.exits} />
                <p className="mt-1 text-[10px] leading-snug text-paper/50">
                  Room colour: how many survived when the fire started there (green all, yellow most, orange many lost, red worst). Grey: no fire there. Green
                  circles: people out through each exit, all fires.
                </p>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-2">
                  {[
                    ["Survived", `${pct(report.survived, report.total)}%`, `${report.survived}/${report.total} across ${report.drills.length} fires`],
                    ["Worst fire", worst ? `${worst.survived}/${worst.agents}` : "–", worst?.scenario ?? ""],
                    ["Avg time out", report.everyoneOut === null ? "–" : `${report.everyoneOut}s`, `cost $${report.cost.toFixed(2)}`],
                  ].map(([label, value, sub]) => (
                    <div key={label} className="border border-paper/15 bg-night/60 p-2">
                      <div className="text-[9px] font-black uppercase tracking-[0.14em] text-paper/45">{label}</div>
                      <div className="font-mono text-lg font-black">{value}</div>
                      <div className="truncate text-[10px] text-paper/50" title={sub}>{sub}</div>
                    </div>
                  ))}
                </div>

                <div>
                  <h3 className="text-[11px] font-black uppercase tracking-[0.16em] text-danger">Who this plan fails</h3>
                  <ul className="mt-1.5 space-y-1">
                    {report.risk.map((g) => {
                      const rate = pct(g.survived, g.seen);
                      const slow = g.meanOut !== null && report.everyoneOut !== null && g.meanOut > report.everyoneOut * 1.25;
                      return (
                        <li key={g.kind} className="border-l-4 bg-night/50 px-2.5 py-1.5 text-[12px]" style={{ borderLeftColor: riskColor(rate) }}>
                          <div className="flex items-baseline justify-between gap-2">
                            <b>
                              {g.icon} {g.label}
                            </b>
                            <span className="shrink-0 font-mono text-[11px]">
                              {g.survived}/{g.seen} survived{g.meanOut !== null ? ` · out in ${g.meanOut}s` : ""}
                            </span>
                          </div>
                          {(g.lostIn.length > 0 || slow || g.commonTrouble) && (
                            <div className="text-[11px] leading-snug text-paper/60">
                              {[g.lostIn.length ? `lost in: ${g.lostIn.join(", ")}` : "", slow ? "much slower than everyone else" : "", g.commonTrouble ?? ""].filter(Boolean).join(" · ")}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead className="text-[9px] font-black uppercase tracking-[0.14em] text-paper/45">
                  <tr>
                    <th className="py-1 pr-3">Fire, worst first</th>
                    <th className="py-1 pr-3">Survived</th>
                    <th className="py-1 pr-3">Last out</th>
                    <th className="py-1 pr-3">Exits used</th>
                    <th className="py-1" />
                  </tr>
                </thead>
                <tbody>
                  {report.drills.map((d) => (
                    <tr key={d.scenarioId} className="border-t border-paper/10">
                      <td className="py-1.5 pr-3 font-bold">{d.scenario}</td>
                      <td className="py-1.5 pr-3 font-mono" style={{ color: riskColor(pct(d.survived, d.agents)) }}>
                        {d.survived}/{d.agents}
                      </td>
                      <td className="py-1.5 pr-3 font-mono">{d.lastOut === null ? "–" : `${d.lastOut}s`}</td>
                      <td className="py-1.5 pr-3 text-paper/70">{Object.entries(d.exits).map(([exit, n]) => `${exit} ${n}`).join(" · ") || "none"}</td>
                      <td className="py-1.5 text-right">
                        {d.replayId && (
                          <button onClick={() => onWatch(d.replayId!, d.scenario)} className="border border-[#38bdf8] px-2 py-0.5 text-[10px] font-black uppercase text-[#38bdf8] hover:bg-[#38bdf8] hover:text-ink">
                            ▶ Watch
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 space-y-3">
              {trial && trial.drills.length > 0 && <BeforeAfter base={run!} trial={trial} onWatch={onWatch} />}
              {run!.drills.length === run!.total && <FixAndProve run={run!} busy={busy} onProve={onProve} />}
            </div>
            {Object.keys(report.lostAt).length > 0 && (
              <p className="mt-3 text-[12px] text-paper/70">
                <b className="text-danger">Where people were lost:</b>{" "}
                {Object.entries(report.lostAt)
                  .sort((a, b) => b[1] - a[1])
                  .map(([where, n]) => `${where} (${n})`)
                  .join(" · ")}
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
