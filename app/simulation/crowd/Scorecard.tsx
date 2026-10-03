"use client";

import type { AuditDrill, AuditPerson } from "./engine";
import { fixById, type FixId } from "./fixes";

/**
 * The evidence scorecard: the ways people actually die in building fires, each one measured in
 * these drills and passed or failed, with the research behind it and the fix that targets it.
 * `scorecard` is a pure function of recorded drills; the component only draws it.
 */

export interface Check {
  id: string;
  title: string;
  /** what was measured, in one line */
  measured: string;
  pass: boolean;
  /** the real-world evidence that this is a killer */
  evidence: string;
  source: string;
  fix: FixId | null;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (part: number, whole: number) => Math.round((100 * part) / Math.max(1, whole));

export function scorecard(drills: AuditDrill[]): Check[] {
  const people: AuditPerson[] = drills.flatMap((d) => d.people);
  if (!people.length) return [];
  const out = people.filter((p) => p.status === "safe" && p.endedAt !== null);
  const everyoneOut = mean(out.map((p) => p.endedAt!));

  const disabled = people.filter((p) => p.kind === "wheelchair" || p.kind === "elderly");
  const disabledOut = disabled.filter((p) => p.status === "safe" && p.endedAt !== null);
  const disabledLost = disabled.filter((p) => !p.survived).length;
  const disabledSlow = disabledOut.length > 0 && mean(disabledOut.map((p) => p.endedAt!)) > everyoneOut * 1.5;

  // people who never moved count at the length of their drill: they waited the whole time
  const starts = people.map((p) => p.firstMoveAt ?? p.endedAt ?? 240);
  const avgStart = mean(starts);
  const worstStart = Math.max(...starts);

  const deaf = people.filter((p) => p.kind === "deaf");
  const deafLate = deaf.filter((p) => p.noticedAt === null || p.noticedAt > 10);
  const deafMissed = deaf.reduce((n, p) => n + (p.missedOrders ?? 0), 0);

  // closer to another exit, yet still out through the main entrance they came in by
  const couldGoElsewhere = out.filter((p) => p.nearestExit && p.nearestExit !== "main");
  const familiar = couldGoElsewhere.filter((p) => p.exit === "main");

  const exits: Record<string, number> = {};
  for (const p of out) if (p.exit) exits[p.exit] = (exits[p.exit] ?? 0) + 1;
  const busiest = Object.entries(exits).sort((a, b) => b[1] - a[1])[0];
  const busiestShare = busiest ? pct(busiest[1], out.length) : 0;

  const blinded = people.filter((p) => (p.blindFor ?? 0) > 10);

  return [
    {
      id: "disabled",
      title: "Disabled people left behind",
      measured: disabled.length
        ? `${disabled.length - disabledLost}/${disabled.length} wheelchair users and elderly people survived${disabledOut.length ? `, out in ${Math.round(mean(disabledOut.map((p) => p.endedAt!)))}s vs ${Math.round(everyoneOut)}s for everyone` : ""}`
        : "no wheelchair users or elderly people in these drills",
      pass: disabledLost === 0 && !disabledSlow,
      evidence: "41% of Grenfell Tower's disabled residents died, the highest share of any group; none had an evacuation plan.",
      source: "Grenfell Tower Inquiry",
      fix: "ramp",
    },
    {
      id: "delay",
      title: "Slow to start moving",
      measured: `first step after the alarm: ${Math.round(avgStart)}s on average, ${Math.round(worstStart)}s at worst`,
      pass: avgStart <= 15 && worstStart <= 45,
      evidence: "In unannounced drills the delay before people move is 30 to 50% of the whole evacuation; in real fires it has run past 10 minutes.",
      source: "Fire Technology (Springer), NIST",
      fix: "voice-alarm",
    },
    {
      id: "deaf",
      title: "Deaf people never alerted",
      measured: deaf.length
        ? `${deaf.length - deafLate.length}/${deaf.length} deaf people knew within 10s${deafMissed ? `; ${deafMissed} order${deafMissed === 1 ? "" : "s"} by name never reached them` : ""}`
        : "no deaf people in these drills",
      pass: deafLate.length === 0 && deafMissed === 0,
      evidence: "In an unannounced drill at an institution for deaf people, evacuation spread only by sight and by other people.",
      source: "Lund University; Fire Industry Association",
      fix: "strobes",
    },
    {
      id: "familiar",
      title: "Everyone heads for the door they came in by",
      measured: couldGoElsewhere.length
        ? `${pct(familiar.length, couldGoElsewhere.length)}% of those nearer another exit still left by the main entrance`
        : "everyone who got out was nearest the main entrance anyway",
      pass: pct(familiar.length, couldGoElsewhere.length) <= 25,
      evidence: "At the Station nightclub fire, about 90% of people ran for the front door they came in by; side exits went largely unused.",
      source: "NIST Station nightclub investigation",
      fix: "low-signs",
    },
    {
      id: "one-way",
      title: "One way out takes everyone",
      measured: busiest ? `the ${busiest[0]} exit carried ${busiestShare}% of everyone who got out` : "nobody got out",
      pass: !!busiest && busiestShare <= 60,
      evidence: "94 children died at Kumbakonam, India, in a school with one narrow staircase and no emergency exit.",
      source: "Kumbakonam school fire inquiry, 2004",
      fix: "voice-alarm",
    },
    {
      id: "smoke",
      title: "Smoke hides the signs",
      measured: `${blinded.length}/${people.length} people spent more than 10s where they could not read a sign`,
      pass: blinded.length <= Math.max(1, Math.round(people.length * 0.1)),
      evidence: "Smoke gathers at the ceiling and hides overhead exit signs first, just when people need them.",
      source: "Photoluminescent way-finding guidance",
      fix: "low-signs",
    },
  ];
}

export function ScorecardView({ drills, compact = false }: { drills: AuditDrill[]; compact?: boolean }) {
  const checks = scorecard(drills);
  if (!checks.length) return null;
  const passed = checks.filter((c) => c.pass).length;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[11px] font-black uppercase tracking-[0.16em] text-sun">The six ways people die in fires</h3>
        <span className="font-mono text-[11px] text-paper/70">
          {passed}/{checks.length} passed
        </span>
      </div>
      <ul className={`mt-1.5 grid gap-1.5 ${compact ? "" : "md:grid-cols-2"}`}>
        {checks.map((c) => (
          <li key={c.id} className="border-l-4 bg-night/50 px-2.5 py-1.5" style={{ borderLeftColor: c.pass ? "#2fd18f" : "#ef4444" }}>
            <div className="flex items-baseline justify-between gap-2 text-[12px]">
              <b>{c.title}</b>
              <span className={`shrink-0 text-[10px] font-black uppercase ${c.pass ? "text-mint" : "text-danger"}`}>{c.pass ? "pass" : "fail"}</span>
            </div>
            <div className="text-[11px] leading-snug text-paper/75">{c.measured}</div>
            {!compact && (
              <div className="mt-0.5 text-[10px] leading-snug text-paper/45">
                {c.evidence} <i>({c.source})</i>
                {!c.pass && c.fix && <span className="text-sun"> · Fix to try: {fixById(c.fix).title}</span>}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
