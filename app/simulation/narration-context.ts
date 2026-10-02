/**
 * Turns the live drill state into the line the narrator should say.
 *
 * Runs identically on the client and in the API route. The client composes the caption so
 * it can appear the instant something happens, and sends only the *state* to the server,
 * which composes the same string and synthesizes it. Two consequences worth the design:
 *
 *   - no free text ever reaches Polly, so the route cannot be used to run up a bill
 *   - the caption and the voice can never disagree, because they come from one function
 *
 * Continuous values are bucketed before they enter a line. A narrator that says "air at
 * sixty-three percent" would mint a brand new Polly clip on almost every step; rounding to
 * tens means the same handful of sentences recur and the audio cache actually hits.
 */

import {
  SCENARIO_OBJECTS,
  nextScenarioGuidance,
  roomById,
  type RoomId,
  type ScenarioObjectId,
  type ScenarioProgress,
} from "./level.ts";
import { NEXT_INSTRUCTION, ROOM_NARRATION } from "./narration-script.ts";

export type DrillEvent =
  | { kind: "room"; sector: RoomId }
  | { kind: "objective"; objective: ScenarioObjectId };

export type DrillContext = {
  event: DrillEvent;
  progress: ScenarioProgress;
  /** Rounded to the nearest ten so repeated readings reuse the same audio. */
  airPercent: number;
  /** 0 none, 1 hazy, 2 thick, 3 severe. */
  smokeLevel: 0 | 1 | 2 | 3;
  routeStatus: "clear" | "unsafe" | "intervened";
};

export const bucketAir = (air: number) => Math.max(0, Math.min(100, Math.round(air / 10) * 10));

export const bucketSmoke = (intensity: number): DrillContext["smokeLevel"] =>
  intensity >= 0.75 ? 3 : intensity >= 0.45 ? 2 : intensity >= 0.15 ? 1 : 0;

const OBJECT_ROOM = new Map<ScenarioObjectId, RoomId>(SCENARIO_OBJECTS.map((item) => [item.id, item.room]));
const OBJECT_LABEL = new Map<ScenarioObjectId, string>(SCENARIO_OBJECTS.map((item) => [item.id, item.label.toLowerCase()]));

/**
 * At most one condition is ever spoken, and only when it changes what the evacuee should
 * do. A narrator that reports every reading turns into noise the player tunes out, which
 * is the opposite of the point — so mild smoke and comfortable air say nothing at all.
 */
function condition(context: DrillContext): string | null {
  if (context.airPercent <= 20) return `Air down to ${context.airPercent} percent. Move now.`;
  if (context.routeStatus === "unsafe") return "The east route is no longer safe. Use the west passage.";
  if (context.smokeLevel === 3) return "Smoke is severe here. Stay low.";
  if (context.airPercent <= 40) return `Air at ${context.airPercent} percent.`;
  if (context.smokeLevel === 2) return "Smoke is getting thick through here.";
  return null;
}

/**
 * The line for the current situation. Room arrivals lead with the place and then say what
 * is still wanted there; completions lead with the confirmation and then the next step.
 * Everything after that is whatever the hazards justify, and nothing more.
 */
export function composeGuidance(context: DrillContext): string {
  const parts: string[] = [];

  if (context.event.kind === "room") {
    const sector = context.event.sector;
    parts.push(ROOM_NARRATION[sector] ?? `${roomById(sector).name}.`);

    // name only the step they are actually on, not every outstanding item: reading a
    // four-item checklist at someone walking into smoke is not guidance
    const next = nextScenarioGuidance(context.progress);
    if (next.id !== "complete" && OBJECT_ROOM.get(next.id) === sector) {
      parts.push(`Your next step is here: the ${OBJECT_LABEL.get(next.id)}.`);
    }
  } else {
    const objective = context.event.objective;
    parts.push(DONE_LINE[objective]);
    if (objective !== "main-exit") {
      const next = nextScenarioGuidance(context.progress);
      if (next.id !== "complete") parts.push(NEXT_INSTRUCTION[next.id]);
    }
  }

  const warning = condition(context);
  if (warning) parts.push(warning);
  return parts.join(" ");
}

/** Mirrors the confirmations in the rendered script so both paths say the same words. */
const DONE_LINE: Record<ScenarioObjectId, string> = {
  "emergency-backpack": "Backpack secured.",
  "lab-access-card": "Access card collected.",
  "gas-valve": "Gas valve closed. The leak has stopped.",
  "first-aid-kit": "First-aid kit used. Health restored.",
  "lab-safety-clue": "Safety note read.",
  "academic-guide": "Route guide read.",
  "main-exit": "You made it out. Drill complete.",
};

/* -- wire format --------------------------------------------------------- */

const ROOMS: RoomId[] = ["outside", "entry", "lobby", "wcorr", "ecorr", "sec", "vault", "annex", "atrium", "library", "cafe"];
const ROUTE_STATUS = ["clear", "unsafe", "intervened"] as const;

/**
 * The route accepts state, never prose, so every field is checked before it can reach the
 * composer. Anything malformed is rejected rather than coerced.
 */
export function parseContext(input: unknown): DrillContext | null {
  if (typeof input !== "object" || input === null) return null;
  const body = input as Record<string, unknown>;

  const event = body.event as Record<string, unknown> | undefined;
  if (typeof event !== "object" || event === null) return null;

  let parsedEvent: DrillEvent;
  if (event.kind === "room") {
    if (!ROOMS.includes(event.sector as RoomId)) return null;
    parsedEvent = { kind: "room", sector: event.sector as RoomId };
  } else if (event.kind === "objective") {
    if (!(event.objective as string in DONE_LINE)) return null;
    parsedEvent = { kind: "objective", objective: event.objective as ScenarioObjectId };
  } else {
    return null;
  }

  const rawProgress = body.progress as Record<string, unknown> | undefined;
  if (typeof rawProgress !== "object" || rawProgress === null) return null;
  const progress = {} as ScenarioProgress;
  for (const id of Object.keys(DONE_LINE) as ScenarioObjectId[]) progress[id] = rawProgress[id] === true;

  const air = body.airPercent;
  const smoke = body.smokeLevel;
  if (typeof air !== "number" || !Number.isFinite(air)) return null;
  if (smoke !== 0 && smoke !== 1 && smoke !== 2 && smoke !== 3) return null;
  if (!ROUTE_STATUS.includes(body.routeStatus as (typeof ROUTE_STATUS)[number])) return null;

  return {
    event: parsedEvent,
    progress,
    airPercent: bucketAir(air),
    smokeLevel: smoke,
    routeStatus: body.routeStatus as DrillContext["routeStatus"],
  };
}
