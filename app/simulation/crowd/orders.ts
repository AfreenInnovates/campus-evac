import { INDOOR, LINKS, linksOf, otherSide, placeName, plan, type Link, type RoomId } from "./world";

/**
 * The warden's orders to individual people, and whether each person is following theirs.
 *
 * An order names one destination: a room, an exit, or "shelter where you are". Every time
 * the person decides, their choice is compared with the next doorway on the route to that
 * destination, so the lab can show plainly who listened and who did not.
 */

export type Target =
  | { kind: "room"; room: RoomId; label: string }
  | { kind: "exit"; link: Link; label: string }
  | { kind: "shelter"; label: string }
  /** "get out": whichever way out is nearest to the person */
  | { kind: "out"; label: string }
  /** a destination read back from a recording: only its name is known */
  | { kind: "recorded"; label: string };

export type OrderStatus = "heard" | "following" | "ignored" | "done";

export interface Order {
  t: number;
  message: string;
  target: Target;
  status: OrderStatus;
}

const EXIT_NAMES: Record<string, string> = { main: "Main Exit", west: "West Fire Exit", east: "East Fire Exit", north: "North Fire Exit", south: "South Fire Exit" };

// most specific first: "north corridor" before "corridor", "sports hall" before "hall", "computer lab" before "lab"
const DEMO_WORDS: [RegExp, RoomId][] = [
  [/north corridor|north wing/, "ncorr"],
  [/lecture/, "lecture"],
  [/computer/, "complab"],
  [/sports hall|\bgym\b/, "gym"],
  [/corridor/, "lobby"],
  [/main hall|\bhall\b|atrium/, "atrium"],
  [/library/, "library"],
  [/cafeteria|\bcafe\b|canteen/, "cafe"],
  [/chemistry|\blab\b/, "sec"],
  [/classroom|a201/, "vault"],
  [/electrical|service room/, "annex"],
  [/main entrance|entrance|foyer/, "entry"],
  [/west passage|science block passage/, "wcorr"],
  [/east passage|academic block passage/, "ecorr"],
];

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** How each room can be named: the demo's hand-tuned words, or for a designed floor its room names, longest first. */
let words: { planId: string; list: [RegExp, RoomId][] } | null = null;
function roomWords(): [RegExp, RoomId][] {
  if (words?.planId === plan.id) return words.list;
  const list: [RegExp, RoomId][] = plan.demo
    ? DEMO_WORDS
    : [...plan.rooms]
        .sort((a, b) => placeName(b.id).length - placeName(a.id).length)
        .map((room) => [new RegExp(`\\b${escape(placeName(room.id).toLowerCase())}\\b`), room.id]);
  words = { planId: plan.id, list };
  return list;
}

/** Read a destination out of the warden's words, e.g. "WEST FIRE EXIT" or "the Library". */
export function parseTarget(text: string): Target | null {
  // what to stay away from is not where to go: "avoid Classroom 3" must never send anyone there
  const s = text.toLowerCase().replace(/\b(avoid|away from|stay out of|keep out of|do not (use|go|enter)|don't (use|go|enter)|never use|not through|instead of)\b[^.,;!?]*/g, " ");
  if (/shelter|stay put|stay where you are|shut the door/.test(s)) return { kind: "shelter", label: "Shelter in place" };
  // "leave by the main entrance" means the main exit, not the entrance hall
  const leaving = /\b(get out|out|leave|exit|escape|evacuate|outside)\b/.test(s);
  const main = LINKS.find((l) => l.exit === "main");
  if (leaving && main && /main entrance|front door/.test(s)) return { kind: "exit", link: main, label: EXIT_NAMES.main };
  for (const exit of ["west", "east", "north", "south", "main"] as const) {
    const link = LINKS.find((l) => l.exit === exit);
    if (link && new RegExp(`${exit}\\b[^.]*exit|${exit} fire exit`).test(s)) return { kind: "exit", link, label: EXIT_NAMES[exit] };
  }
  if (/nearest (safe )?(fire )?exit|closest (safe )?exit/.test(s)) return { kind: "out", label: "Nearest exit" };
  for (const [pattern, room] of roomWords()) if (pattern.test(s)) return { kind: "room", room, label: placeName(room) };
  // a bare direction ("#10 go west") means the way out on that side of the building
  const way = s.match(/\b(west|east|north|south)\b/)?.[1] as keyof typeof EXIT_BY_SIDE | undefined;
  const sideExit = way && (LINKS.find((l) => l.exit === way) ?? LINKS.find((l) => l.exit === EXIT_BY_SIDE[way]));
  if (sideExit) return { kind: "exit", link: sideExit, label: EXIT_NAMES[sideExit.exit!] };
  if (leaving || /exit sign|follow the (green )?signs|nearest exit/.test(s)) return { kind: "out", label: "Nearest exit" };
  return null;
}

/** Words that only make sense facing a known way; nobody giving orders over a PA knows which way that is. */
export const isRelative = (text: string) => /\b(left|right|straight ahead|behind you|forward|back)\b/i.test(text);

const EXIT_BY_SIDE = { west: "west", east: "east", north: "north", south: "main" } as const;

/** Whether a doorway itself is the way out an order asks for. */
const exitFits = (link: Link, target: Target) => !!link.exit && (target.kind === "out" || (target.kind === "exit" && link === target.link));

/**
 * Doorways from every room to an order's destination, counted outward from it, never through
 * `avoid` (the fire) when there is another way; through it only when there is no other.
 */
function distances(target: Target, avoid?: RoomId) {
  const goals = INDOOR.filter((room) => (target.kind === "room" ? room === target.room : linksOf(room).some((link) => exitFits(link, target))));
  const spread = (blocked: RoomId | undefined) => {
    const dist = new Map<RoomId, number>(goals.filter((g) => g !== blocked).map((g) => [g, 0]));
    const queue = [...dist.keys()];
    while (queue.length) {
      const room = queue.shift()!;
      for (const link of linksOf(room)) {
        const next = otherSide(link, room);
        if (next === "outside" || next === blocked || dist.has(next)) continue;
        dist.set(next, dist.get(room)! + 1);
        queue.push(next);
      }
    }
    return dist;
  };
  const safe = spread(avoid);
  let anyway: Map<RoomId, number> | null = null;
  return (room: RoomId) => safe.get(room) ?? (anyway ??= spread(undefined)).get(room) ?? Infinity;
}

/** Doorways from a room to the nearest way out, not through the fire when there is another way. */
export const exitDistance = (room: RoomId, avoid?: RoomId) => distances({ kind: "out", label: "Nearest exit" }, avoid)(room);

/** The doorway to take from `from` towards the target: the way out if it is right here, else the neighbour nearest the goal. */
export function nextHop(from: RoomId, target: Target, avoid?: RoomId): Link | null {
  if (target.kind === "shelter" || target.kind === "recorded") return null;
  const here = linksOf(from).find((link) => exitFits(link, target));
  if (here) return here;
  const dist = distances(target, avoid);
  if (dist(from) === 0) return null;
  let best: { link: Link; d: number } | null = null;
  for (const link of linksOf(from)) {
    const next = otherSide(link, from);
    if (next === "outside") continue;
    const d = dist(next);
    if (d < (best?.d ?? Infinity)) best = { link, d };
  }
  return best?.link ?? null;
}

/** The rooms a person would pass through on the way, following `nextHop` from where they stand. */
export function routeRooms(from: RoomId, target: Target, avoid?: RoomId): RoomId[] {
  const rooms: RoomId[] = [];
  let room = from;
  for (let step = 0; step < INDOOR.length; step++) {
    const hop = nextHop(room, target, avoid);
    if (!hop) break;
    room = otherSide(hop, room);
    if (room === "outside") break;
    rooms.push(room);
  }
  return rooms;
}

/**
 * Judge one decision against the person's current order: following means the doorway they
 * chose gets them closer to where they were sent, by whatever reasonable route.
 */
export function judge(order: Order, room: RoomId, chosen: Link | null, sheltered: boolean, avoid?: RoomId): OrderStatus {
  const { target } = order;
  if (target.kind === "shelter") return sheltered ? "done" : "ignored";
  if (target.kind === "recorded") return order.status;
  if (target.kind === "room" && room === target.room) return "done";
  if (!chosen) return "ignored";
  if (exitFits(chosen, target)) return "following";
  const next = otherSide(chosen, room);
  if (next === "outside") return target.kind === "out" ? "following" : "ignored";
  const dist = distances(target, avoid);
  // closer to the goal; or, from inside the fire room, out of it without losing ground
  return dist(next) < dist(room) || (room === avoid && dist(next) <= dist(room)) ? "following" : "ignored";
}

export const STATUS_LABEL: Record<OrderStatus, string> = {
  heard: "heard it",
  following: "following",
  ignored: "not following",
  done: "done",
};
