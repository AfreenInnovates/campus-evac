"use client";

import { useState } from "react";
import { ROOMS, type RoomId } from "../level";
import type { AuditDrill, LabConfig } from "./engine";
import type { QueueItem } from "./Training";
import { LINKS, placeName, SCENARIOS } from "./world";

/**
 * The building audit: the same people, the fire started in every room in turn, and one
 * report on where the evacuation plan breaks and who it leaves behind.
 *
 * The numbers are pure functions of the recorded drills (`summariseAudit`); the panel only
 * draws them.
 */

/* ------------------------------------------------------------------ storage */

export interface AuditRun {
  at: number;
  seed: number;
  total: number;
  drills: AuditDrill[];
}

const KEY = "campusevac:audit";

export function readAudit(): AuditRun | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "null") as AuditRun | null;
  } catch {
    return null;
  }
}

function writeAudit(run: AuditRun) {
  try {
    localStorage.setItem(KEY, JSON.stringify(run));
  } catch {
    /* the report still shows for this visit */
  }
}

/** Start a fresh audit and return the drills to queue: every fire, the same crowd. */
export function beginAudit(seed: number, agents = 12): QueueItem[] {
  writeAudit({ at: Date.now(), seed, total: SCENARIOS.length, drills: [] });
  return SCENARIOS.map((scenario) => ({
    config: { scenarioId: scenario.id, agents, warden: "ai", seed, wardenEvery: 12, playbook: true } satisfies LabConfig,
    tag: "audit",
    learn: false,
  }));
}

export function recordAuditDrill(drill: AuditDrill) {
  const run = readAudit();
  if (run) writeAudit({ ...run, drills: [...run.drills.filter((d) => d.scenarioId !== drill.scenarioId), drill] });
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
  onWatch,
  busy,
}: {
  onClose: () => void;
  onRun: () => void;
  onWatch: (replayId: string, label: string) => void;
  busy: boolean;
}) {
  const [run] = useState(readAudit);
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
