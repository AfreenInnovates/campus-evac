import {
  CRITICAL_SCENARIO_OBJECTS,
  roomById,
  scenarioObjectById,
  type ScenarioObjectId,
} from "./level";

/**
 * The drill debrief, derived entirely from what the run recorded.
 *
 * Every number here is measured, never estimated, so the report is reproducible: the same
 * drill always scores the same. The narrative lines are chosen from the same numbers, which
 * is why no model is involved.
 */

export interface ObjectiveSplit {
  id: ScenarioObjectId;
  label: string;
  room: string;
  /** Seconds into the drill when it was completed, or null if it never was. */
  seconds: number | null;
}

export interface DrillSummary {
  outcome: "escaped" | "failed";
  durationSeconds: number;
  objectivesCompleted: number;
  objectivesTotal: number;
  splits: ObjectiveSplit[];
  mistakes: { at: number; text: string }[];
  health: number;
  lowestAir: number;
  routeMessageAt: number | null;
  interventionApplied: boolean;
  roomCode: string | null;
}

export interface ScoreLine {
  label: string;
  points: number;
  max: number;
  note: string;
}

export interface DrillReport {
  subject: string;
  headline: string;
  band: string;
  score: number;
  lines: ScoreLine[];
  findings: string[];
  splits: ObjectiveSplit[];
  summary: DrillSummary;
}

export const formatClock = (seconds: number) => {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

/** Pace targets for the full six-objective run, in seconds. */
const PAR_SECONDS = 150;
const SLOW_SECONDS = 420;

function clamp(value: number, low: number, high: number) {
  return Math.max(low, Math.min(high, value));
}

export function buildReport(summary: DrillSummary): DrillReport {
  const escaped = summary.outcome === "escaped";

  const exitPoints = escaped ? 50 : 0;
  const objectivePoints = summary.objectivesTotal
    ? Math.round((summary.objectivesCompleted / summary.objectivesTotal) * 25)
    : 0;

  // Full marks at or under par, sliding to zero by the slow mark.
  const pace = clamp((SLOW_SECONDS - summary.durationSeconds) / (SLOW_SECONDS - PAR_SECONDS), 0, 1);
  const pacePoints = escaped ? Math.round(pace * 15) : 0;

  const mistakePenalty = Math.min(12, summary.mistakes.length * 3);
  const airPoints = summary.lowestAir > 50 ? 10 : summary.lowestAir > 25 ? 5 : 0;

  const score = clamp(exitPoints + objectivePoints + pacePoints + airPoints - mistakePenalty, 0, 100);
  const band =
    score >= 85 ? "Exemplary" : score >= 70 ? "Solid" : score >= 50 ? "Needs practice" : "Retrain";

  const lines: ScoreLine[] = [
    {
      label: "Reached the exit",
      points: exitPoints,
      max: 50,
      note: escaped ? "Left through the marked exit." : "The drill ended before the exit.",
    },
    {
      label: "Objectives cleared",
      points: objectivePoints,
      max: 25,
      note: `${summary.objectivesCompleted} of ${summary.objectivesTotal} critical steps completed.`,
    },
    {
      label: "Pace",
      points: pacePoints,
      max: 15,
      note: escaped
        ? `${formatClock(summary.durationSeconds)} against a ${formatClock(PAR_SECONDS)} target.`
        : "Not scored: the drill did not finish.",
    },
    {
      label: "Air management",
      points: airPoints,
      max: 10,
      note: `Air fell to ${Math.round(summary.lowestAir)}%.`,
    },
    {
      label: "Procedure errors",
      points: -mistakePenalty,
      max: 0,
      note: summary.mistakes.length
        ? `${summary.mistakes.length} invalid action${summary.mistakes.length === 1 ? "" : "s"} attempted.`
        : "No invalid actions. Clean run.",
    },
  ];

  const findings: string[] = [];

  const slowest = summary.splits
    .filter((split) => split.seconds !== null)
    .map((split, index, all) => {
      const previous = index ? (all[index - 1].seconds ?? 0) : 0;
      return { ...split, delta: (split.seconds ?? 0) - previous };
    })
    .sort((a, b) => b.delta - a.delta)[0];

  if (escaped && summary.durationSeconds <= PAR_SECONDS)
    findings.push(`Strong pace: out in ${formatClock(summary.durationSeconds)}, inside the ${formatClock(PAR_SECONDS)} target.`);
  else if (escaped)
    findings.push(`Out in ${formatClock(summary.durationSeconds)}. The target for a clean run is ${formatClock(PAR_SECONDS)}.`);
  else findings.push("The drill ended before the exit was reached. Air or health ran out first.");

  if (slowest && slowest.delta > 45)
    findings.push(`Longest gap was reaching ${slowest.label} in ${roomShort(slowest.room)} — ${formatClock(slowest.delta)} on that leg alone.`);

  const missing = summary.splits.filter((split) => split.seconds === null);
  if (missing.length)
    findings.push(`Never completed: ${missing.map((split) => split.label).join(", ")}.`);

  if (summary.mistakes.length)
    findings.push(`Tried to leave before the checklist was clear ${summary.mistakes.length} time${summary.mistakes.length === 1 ? "" : "s"}. Clear every critical step first.`);

  if (summary.lowestAir <= 25) findings.push("Air dropped into the danger band. Move through smoke faster, or route around it.");
  else if (summary.lowestAir <= 50) findings.push("Air dipped below half. Watch how long you linger in smoke.");

  if (summary.routeMessageAt !== null)
    findings.push(`A warden route message arrived at ${formatClock(summary.routeMessageAt)}. Acting on it early is the point of the drill.`);
  else if (summary.roomCode)
    findings.push("No warden route message arrived. Coordination is the half of this drill that was not exercised.");

  if (summary.interventionApplied)
    findings.push("A ventilation override was applied, which thinned the smoke on your route.");

  if (summary.health < 40) findings.push(`Finished on ${Math.round(summary.health)}% health. In a real evacuation that is an injury.`);

  return {
    subject: escaped
      ? `Your drill report - out in ${formatClock(summary.durationSeconds)} (${band})`
      : `Your drill report - did not reach the exit (${band})`,
    headline: escaped ? "You got out safely." : "The drill ended before the exit.",
    band,
    score,
    lines,
    findings,
    splits: summary.splits,
    summary,
  };
}

const roomShort = (name: string) => name.split(" / ").pop() ?? name;

/** The authored objective order, used to lay out splits consistently. */
export const REPORT_STEPS: ScenarioObjectId[] = [...CRITICAL_SCENARIO_OBJECTS, "main-exit"];

export const splitFor = (
  id: ScenarioObjectId,
  times: Partial<Record<ScenarioObjectId, number>>,
): ObjectiveSplit => ({
  id,
  label: scenarioObjectById(id).label,
  room: roomById(scenarioObjectById(id).room).name,
  seconds: times[id] ?? null,
});
