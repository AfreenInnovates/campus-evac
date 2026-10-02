import type { RoomId } from "../level";
import { LINKS, linksOf, otherSide, placeName, type Link } from "./world";

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
  /** a destination read back from a recording: only its name is known */
  | { kind: "recorded"; label: string };

export type OrderStatus = "heard" | "following" | "ignored" | "done";

export interface Order {
  t: number;
  message: string;
  target: Target;
  status: OrderStatus;
}

const EXIT_NAMES: Record<string, string> = { main: "Main Exit", west: "West Fire Exit", east: "East Fire Exit" };

const ROOM_WORDS: [RegExp, RoomId][] = [
  [/corridor/, "lobby"],
  [/main hall|\bhall\b|atrium/, "atrium"],
  [/library/, "library"],
  [/cafeteria|\bcafe\b|canteen/, "cafe"],
  [/chemistry|\blab\b/, "sec"],
  [/classroom|a201/, "vault"],
  [/electrical|service room/, "annex"],
  [/main entrance|entrance|foyer/, "entry"],
  [/science block passage/, "wcorr"],
  [/academic block passage/, "ecorr"],
];

/** Read a destination out of the warden's words, e.g. "WEST FIRE EXIT" or "the Library". */
export function parseTarget(text: string): Target | null {
  const s = text.toLowerCase();
  if (/shelter|stay put|stay where you are|shut the door/.test(s)) return { kind: "shelter", label: "Shelter in place" };
  for (const exit of ["west", "east", "main"] as const) {
    if (new RegExp(`${exit}\\b[^.]*exit|${exit} fire exit`).test(s)) {
      const link = LINKS.find((l) => l.exit === exit)!;
      return { kind: "exit", link, label: EXIT_NAMES[exit] };
    }
  }
  for (const [pattern, room] of ROOM_WORDS) if (pattern.test(s)) return { kind: "room", room, label: placeName(room) };
  return null;
}

/** The doorway to take from `from` on the shortest route to the target, through indoor rooms. */
export function nextHop(from: RoomId, target: Target): Link | null {
  if (target.kind !== "room" && target.kind !== "exit") return null;
  if (target.kind === "exit" && from === target.link.a) return target.link;
  const goal = target.kind === "exit" ? target.link.a : target.room;
  if (from === goal) return null;
  const firstLink = new Map<RoomId, Link>();
  const queue: RoomId[] = [from];
  const seen = new Set<RoomId>([from]);
  while (queue.length) {
    const room = queue.shift()!;
    for (const link of linksOf(room)) {
      const next = otherSide(link, room);
      if (next === "outside" || seen.has(next)) continue;
      seen.add(next);
      firstLink.set(next, firstLink.get(room) ?? link);
      if (next === goal) return firstLink.get(next)!;
      queue.push(next);
    }
  }
  return null;
}

/** Judge one decision against the person's current order. */
export function judge(order: Order, room: RoomId, chosen: Link | null, sheltered: boolean): OrderStatus {
  const { target } = order;
  if (target.kind === "shelter") return sheltered ? "done" : "ignored";
  if (target.kind === "room" && room === target.room) return "done";
  const hop = nextHop(room, target);
  if (!hop) return order.status;
  return chosen === hop ? "following" : "ignored";
}

export const STATUS_LABEL: Record<OrderStatus, string> = {
  heard: "heard it",
  following: "following",
  ignored: "not following",
  done: "done",
};
