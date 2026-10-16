import { FIXES } from "../simulation/crowd/fixes";
import { parseTarget } from "../simulation/crowd/orders";
import {
  compass,
  hopsFrom,
  INDOOR,
  LINKS,
  linksOf,
  otherSide,
  placeName,
  plan,
  roomById,
  roomCenter,
  SCENARIOS,
  signFrom,
  smokeAt,
  smokeWord,
  type Link,
  type RoomId,
} from "../simulation/crowd/world";

/**
 * The building knowledge behind the MCP server, as plain functions with no I/O, so a voice
 * assistant can ask the same questions the Crowd Lab's warden reasons over: where am I, which
 * way is out, where is the smoke, and who should go where.
 *
 * Routes are searched over the plan's rooms and doorways (the same graph the agents walk),
 * weighted by the smoke the lab's own fire model puts in each room at that moment, so a route
 * here is the one the simulation would count as safe.
 */

const EXIT_NAMES: Record<NonNullable<Link["exit"]>, string> = {
  main: "Main Exit",
  west: "West Fire Exit",
  east: "East Fire Exit",
  north: "North Fire Exit",
  south: "South Fire Exit",
};

/** Smoke worth crawling under: the sim's "thick smoke". */
export const THICK_SMOKE = 0.3;
/** Smoke too dense to cross at all, even crawling: the sim's "very thick, choking smoke". */
export const CHOKING_SMOKE = 0.6;
/** Seconds after ignition to assume when the caller does not say. */
export const DEFAULT_SECONDS = 60;

const exitName = (link: Link) => EXIT_NAMES[link.exit!];
const exits = () => LINKS.filter((link) => link.exit);

/* ------------------------------------------------------------------ rooms */

/**
 * A room from whatever a person would call it: its id, its name, or the words the warden's
 * orders are read with ("the gym", "chemistry", "main hall").
 */
export function resolveRoom(text: string): RoomId | null {
  const s = text.trim().toLowerCase();
  if (!s) return null;
  if (INDOOR.includes(s)) return s;
  const named = plan.rooms.find((room) => room.name.toLowerCase() === s || placeName(room.id).toLowerCase() === s);
  if (named) return named.id;
  const target = parseTarget(s);
  if (target?.kind === "room") return target.room;
  const partial = plan.rooms.find((room) => room.name.toLowerCase().includes(s));
  return partial?.id ?? null;
}

export function describeBuilding() {
  return {
    building: plan.label,
    rooms: plan.rooms.map((room) => ({ id: room.id, name: placeName(room.id), kind: room.kind ?? null })),
    exits: exits().map((link) => {
      const inside = link.a === "outside" ? link.b : link.a;
      return { name: exitName(link), from_room: placeName(inside), step_free: !link.steps, sign: signFrom(link, inside) };
    }),
    fire_scenarios: SCENARIOS.map((s) => ({ id: s.id, label: s.label, fire_room: placeName(s.origin), note: s.blurb })),
  };
}

/* ------------------------------------------------------------------ smoke */

export interface Fire {
  room: RoomId;
  seconds: number;
}

export function smokeForecast(fire: Fire) {
  const hops = hopsFrom(fire.room);
  return INDOOR.map((room) => {
    const smoke = smokeAt(room, fire.seconds, hops);
    return { room: placeName(room), smoke: Math.round(smoke * 100) / 100, condition: room === fire.room ? "on fire" : smokeWord(smoke) };
  }).sort((a, b) => b.smoke - a.smoke);
}

/* ------------------------------------------------------------------ routes */

export interface RouteStep {
  from: string;
  to: string;
  heading: string;
  sign: string;
  smoke_ahead: string;
}

export interface Route {
  exit: string;
  step_free: boolean;
  steps: RouteStep[];
  doorways: number;
  /** the worst smoke on the way, 0-1, not counting the room you start in */
  worst_smoke: number;
  through_fire: boolean;
  cost: number;
}

export interface RouteOptions {
  fire?: Fire | null;
  stepFree?: boolean;
  /** only consider this way out */
  exit?: Link;
}

/**
 * The cheapest way out of `from`: one point per doorway, plus a heavy price for smoke and a
 * near-ban on walking through the fire room, so it is used only when nothing else is open.
 * Stepped exits are left out entirely for a wheelchair user.
 */
export function findRoute(from: RoomId, options: RouteOptions = {}): Route | null {
  const { fire, stepFree, exit } = options;
  const hops = fire ? hopsFrom(fire.room) : null;
  const smoke = (room: RoomId) => (hops && fire ? smokeAt(room, fire.seconds, hops) : 0);
  const enter = (room: RoomId) => 1 + smoke(room) * 8 + (fire && room === fire.room ? 60 : 0);
  const usable = (link: Link) => !(stepFree && link.steps) && (!link.exit || !exit || link === exit);

  const cost = new Map<RoomId, number>([[from, 0]]);
  const via = new Map<RoomId, Link>();
  const done = new Set<RoomId>();
  let best: { link: Link; room: RoomId; cost: number } | null = null;

  // Dijkstra over a dozen rooms: a linear scan for the next room is plenty
  for (;;) {
    let room: RoomId | null = null;
    for (const [r, c] of cost) if (!done.has(r) && (room === null || c < cost.get(room)!)) room = r;
    if (room === null) break;
    done.add(room);
    const here = cost.get(room)!;
    if (best && here >= best.cost) break;
    for (const link of linksOf(room)) {
      if (!usable(link)) continue;
      const next = otherSide(link, room);
      if (next === "outside") {
        if (link.exit && (!best || here + 1 < best.cost)) best = { link, room, cost: here + 1 };
        continue;
      }
      const c = here + enter(next);
      if (c < (cost.get(next) ?? Infinity)) {
        cost.set(next, c);
        via.set(next, link);
      }
    }
  }
  if (!best) return null;

  // walk back from the exit to the start
  const chain: { link: Link; room: RoomId }[] = [{ link: best.link, room: best.room }];
  for (let room = best.room; room !== from; ) {
    const link = via.get(room)!;
    room = otherSide(link, room);
    chain.unshift({ link, room });
  }

  const steps: RouteStep[] = chain.map(({ link, room }) => {
    const to = otherSide(link, room);
    return {
      from: placeName(room),
      to: to === "outside" ? "outside" : placeName(to),
      // an exit door is named for its side of the building; a room's centre can mislead
      heading: link.exit && link.exit !== "main" ? link.exit : compass(roomCenter(room), link.door),
      sign: signFrom(link, room),
      smoke_ahead: to === "outside" ? "fresh air" : fire && to === fire.room ? "the fire" : smokeWord(smoke(to)),
    };
  });
  const passed = chain.slice(1).map(({ room }) => room);
  return {
    exit: exitName(best.link),
    step_free: !best.link.steps,
    steps,
    doorways: chain.length,
    worst_smoke: Math.round(Math.max(0, ...passed.map(smoke)) * 100) / 100,
    through_fire: !!fire && passed.includes(fire.room),
    cost: Math.round(best.cost * 10) / 10,
  };
}

const firstUpper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One route as directions a person can follow by ear, no map and no left or right. */
export function speakRoute(route: Route) {
  const parts = route.steps.map((step, i) => {
    const lead = i === 0 ? `From the ${step.from}, head ${step.heading}` : `then head ${step.heading}`;
    return step.to === "outside"
      ? `${lead} out through the ${route.exit}`
      : `${lead} through the doorway signed "${step.sign}" into the ${step.to}`;
  });
  return `${firstUpper(parts.join(", "))}.`;
}

export type Advice =
  | { action: "evacuate"; route: Route; speech: string }
  | { action: "shelter"; route: Route | null; reason: string; speech: string };

const SHELTER_SPEECH =
  "Shelter where you are: shut the door, put cloth along the gap under it, stay low by a window and call for help so firefighters know your room.";

/**
 * What one person should do: the route out, or sheltering in place when every way out runs
 * through the fire or thick smoke. Starting in the fire room, leaving is always right.
 */
export function adviseRoute(from: RoomId, options: RouteOptions = {}): Advice {
  const route = findRoute(from, options);
  const inFireRoom = !!options.fire && from === options.fire.room;
  if (!route) {
    const reason = options.stepFree ? "No step-free way out is open from here." : "No way out is open from here.";
    return { action: "shelter", route: null, reason, speech: `${reason} ${SHELTER_SPEECH}` };
  }
  if (!inFireRoom && (route.through_fire || route.worst_smoke >= CHOKING_SMOKE)) {
    const reason = route.through_fire ? "Every way out runs through the fire." : `The best way out runs through ${smokeWord(route.worst_smoke)}.`;
    return { action: "shelter", route, reason, speech: `${reason} ${SHELTER_SPEECH}` };
  }
  const low = route.worst_smoke >= THICK_SMOKE ? " Crawl under the smoke, it is thick on the way." : route.worst_smoke >= 0.08 ? " Stay low under the smoke." : "";
  return { action: "evacuate", route, speech: `${speakRoute(route)}${low} Do not use the lifts, and do not go back for belongings.` };
}

/* ------------------------------------------------------------------ the warden's plan */

export interface Assignment {
  room: string;
  people: number;
  action: "evacuate" | "shelter";
  exit: string | null;
  route: string[];
  directions: string;
}

/**
 * A whole-building plan, the way a warden would announce it: every occupied room gets the way
 * out that costs it least once the exits already given out are counted, so a crowd is spread
 * over the safe exits instead of all sent to the main door.
 */
export function planEvacuation(fire: Fire | null, occupancy: Map<RoomId, number>) {
  const load = new Map<string, number>();
  const rooms = [...occupancy].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const assignments: Assignment[] = [];

  for (const [room, people] of rooms) {
    let best: { advice: Advice; score: number } | null = null;
    for (const exit of exits()) {
      const advice = adviseRoute(room, { fire, exit });
      if (advice.action !== "evacuate") continue;
      // each person already sent to an exit adds a little queueing at its door
      const score = advice.route.cost + ((load.get(advice.route.exit) ?? 0) + people) * 0.08;
      if (!best || score < best.score) best = { advice, score };
    }
    const advice = best?.advice ?? adviseRoute(room, { fire });
    if (advice.action === "evacuate") load.set(advice.route.exit, (load.get(advice.route.exit) ?? 0) + people);
    assignments.push({
      room: placeName(room),
      people,
      action: advice.action,
      exit: advice.action === "evacuate" ? advice.route.exit : null,
      route: advice.route ? advice.route.steps.map((step) => step.to) : [],
      directions: advice.speech,
    });
  }

  const byExit = new Map<string, string[]>();
  for (const a of assignments) if (a.exit) byExit.set(a.exit, [...(byExit.get(a.exit) ?? []), a.room]);
  const shelter = assignments.filter((a) => a.action === "shelter").map((a) => a.room);
  const avoid = fire ? ` Keep away from the ${placeName(fire.room)}.` : "";
  const sentences = [...byExit].map(([exit, list]) => `${list.join(", ")}: leave by the ${exit}.`);
  if (shelter.length) sentences.push(`${shelter.join(", ")}: shut your door and shelter in place, help is coming.`);
  const broadcast = `Attention please, this is a fire evacuation. Leave now.${avoid} ${sentences.join(" ")}`.trim();

  return {
    fire_room: fire ? placeName(fire.room) : null,
    seconds_since_ignition: fire?.seconds ?? null,
    exit_load: Object.fromEntries(load),
    assignments,
    broadcast,
  };
}

/** Everyone the demo assumes is in a room when no head count is given: one group per room. */
export const everyRoom = () => new Map(INDOOR.map((room) => [room, roomById(room).people ?? 1] as [RoomId, number]));

/* ------------------------------------------------------------------ fixes */

export const safetyFixes = () =>
  FIXES.map((fix) => ({ id: fix.id, title: fix.title, what_changes: fix.detail, protects: fix.helps, why: fix.basis }));
