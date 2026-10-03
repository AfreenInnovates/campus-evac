import { EAST_EXIT_Z, NCORR_Z, NORTH_EXIT_X, NORTH_Z, roomAt, roomById, WEST_EXIT_Z, type RoomId } from "../level";

/**
 * The building as the crowd experiences it: rooms joined by doorways, three ways out, and a
 * fire that starts in one room and fills the rest by how many doorways away they are.
 *
 * Positions are [x, z] on the floor plane.
 */

export type P2 = [number, number];

export interface Link {
  id: string;
  a: RoomId;
  b: RoomId;
  /** the doorway itself */
  door: P2;
  /** a standing point just inside each side */
  pa: P2;
  pb: P2;
  /** what the signage over this doorway says, as a person would read it */
  sign: { fromA: string; fromB: string };
  exit?: "main" | "west" | "east" | "north";
  /** steps on the far side: no way through for a wheelchair */
  steps?: boolean;
}

export const LINKS: Link[] = [
  { id: "entry-lobby", a: "entry", b: "lobby", door: [0, 7], pa: [0, 8.4], pb: [0, 5.4], sign: { fromA: "corridor, signs to Science and Academic blocks", fromB: "MAIN ENTRANCE, green EXIT sign beyond" } },
  { id: "main-exit", a: "entry", b: "outside", door: [0, 10.5], pa: [0, 9.3], pb: [0, 15.5], exit: "main", sign: { fromA: "MAIN EXIT glass doors to the plaza", fromB: "main entrance" } },
  { id: "lobby-wcorr", a: "lobby", b: "wcorr", door: [-5.5, 2.5], pa: [-4.2, 2.5], pb: [-6.75, 2.5], sign: { fromA: "SCIENCE BLOCK / Chemistry Lab 1A", fromB: "central corridor" } },
  { id: "wcorr-sec", a: "wcorr", b: "sec", door: [-8, 2.5], pa: [-6.75, 2.5], pb: [-9.6, 0.9], sign: { fromA: "CHEMISTRY LAB 1A", fromB: "passage to the central corridor" } },
  { id: "lobby-ecorr", a: "lobby", b: "ecorr", door: [5.5, 2.5], pa: [4.2, 2.5], pb: [6.75, 2.5], sign: { fromA: "ACADEMIC BLOCK / Classroom A201", fromB: "central corridor" } },
  { id: "ecorr-vault", a: "ecorr", b: "vault", door: [8, 2.5], pa: [6.75, 2.5], pb: [9.6, 2.5], sign: { fromA: "CLASSROOM A201", fromB: "passage to the central corridor" } },
  { id: "vault-annex", a: "vault", b: "annex", door: [15, -7], pa: [15, -5.6], pb: [15, -8.5], sign: { fromA: "ELECTRICAL SERVICE (dead end)", fromB: "Classroom A201" } },
  { id: "lobby-atrium", a: "lobby", b: "atrium", door: [0, -7], pa: [0, -5.6], pb: [0, -8.6], sign: { fromA: "MAIN HALL / LIBRARY / CAFETERIA", fromB: "central corridor, main entrance beyond" } },
  { id: "atrium-library", a: "atrium", b: "library", door: [-8, -16], pa: [-6.6, -16], pb: [-9.6, -16], sign: { fromA: "LIBRARY", fromB: "MAIN HALL" } },
  { id: "atrium-cafe", a: "atrium", b: "cafe", door: [8, -17.5], pa: [6.6, -17.5], pb: [9.6, -17.5], sign: { fromA: "CAFETERIA", fromB: "MAIN HALL" } },
  { id: "west-exit", a: "library", b: "outside", door: [-22, WEST_EXIT_Z], pa: [-20.6, WEST_EXIT_Z], pb: [-26.5, WEST_EXIT_Z], exit: "west", steps: true, sign: { fromA: "FIRE EXIT (west), green running-man sign, steps down outside", fromB: "library" } },
  { id: "east-exit", a: "cafe", b: "outside", door: [22, EAST_EXIT_Z], pa: [20.6, EAST_EXIT_Z], pb: [26.5, EAST_EXIT_Z], exit: "east", sign: { fromA: "FIRE EXIT (east), green running-man sign", fromB: "cafeteria" } },
  /* the north wing */
  { id: "atrium-ncorr", a: "atrium", b: "ncorr", door: [-5.5, -25], pa: [-5.5, -23.4], pb: [-5.5, -27], sign: { fromA: "NORTH WING: Lecture Theatre, Computer Lab, Sports Hall", fromB: "MAIN HALL, main entrance beyond" } },
  { id: "cafe-ncorr", a: "cafe", b: "ncorr", door: [20.6, -25], pa: [20.6, -23.4], pb: [20.6, -27], sign: { fromA: "NORTH WING corridor", fromB: "CAFETERIA, east fire exit beyond" } },
  { id: "ncorr-lecture", a: "ncorr", b: "lecture", door: [-14, NCORR_Z], pa: [-14, -27], pb: [-14, -30.6], sign: { fromA: "LECTURE THEATRE", fromB: "north corridor" } },
  { id: "ncorr-complab", a: "ncorr", b: "complab", door: [0, NCORR_Z], pa: [0, -27], pb: [0, -30.6], sign: { fromA: "COMPUTER LAB", fromB: "north corridor" } },
  { id: "ncorr-gym", a: "ncorr", b: "gym", door: [14, NCORR_Z], pa: [14, -27], pb: [14, -30.6], sign: { fromA: "SPORTS HALL, fire exit beyond", fromB: "north corridor, Main Hall beyond" } },
  { id: "north-exit", a: "gym", b: "outside", door: [NORTH_EXIT_X, NORTH_Z], pa: [NORTH_EXIT_X, NORTH_Z + 1.4], pb: [NORTH_EXIT_X, NORTH_Z - 4], exit: "north", sign: { fromA: "FIRE EXIT (north) to the sports field, green running-man sign", fromB: "sports hall" } },
];

/** Rooms people can start in, and where the fire can start. */
export const INDOOR: RoomId[] = ["entry", "lobby", "wcorr", "ecorr", "sec", "vault", "annex", "atrium", "library", "cafe", "ncorr", "lecture", "complab", "gym"];

export const placeName = (room: RoomId) => (room === "outside" ? "outside" : roomById(room).name.split(" / ").pop()!);

export const linksOf = (room: RoomId) => LINKS.filter((link) => link.a === room || link.b === room);

export const otherSide = (link: Link, room: RoomId) => (link.a === room ? link.b : link.a);

/** Standing point on the far side of a doorway, seen from `room`. */
export const farPoint = (link: Link, room: RoomId): P2 => (link.a === room ? link.pb : link.pa);
export const nearPoint = (link: Link, room: RoomId): P2 => (link.a === room ? link.pa : link.pb);
export const signFrom = (link: Link, room: RoomId) => (link.a === room ? link.sign.fromA : link.sign.fromB);

export function compass(from: P2, to: P2) {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? "east" : "west";
  return dz > 0 ? "south" : "north";
}

export function roomCenter(room: RoomId): P2 {
  const b = roomById(room).bounds;
  return [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2];
}

/** Clear of the building, far enough from the doors to count as out. */
export function isSafe(x: number, z: number) {
  return roomAt(x, z) === "outside" && (z > 12.5 || x < -23.5 || x > 23.5 || z < NORTH_Z - 2);
}

/** The west fire exit opens onto a landing and three steps down to the lawn. */
export const WEST_STEPS = { fromX: -22.1, landing: 0.6, tread: 0.42, rise: 0.15, count: 3, halfWidth: 1.1, z: WEST_EXIT_Z };

/** How high the ground is under a point: zero everywhere except the west exit's steps. */
export function floorHeight(x: number, z: number) {
  const s = WEST_STEPS;
  if (Math.abs(z - s.z) > s.halfWidth || x > s.fromX) return 0;
  const along = s.fromX - x;
  if (along < s.landing) return s.rise * s.count;
  const step = Math.floor((along - s.landing) / s.tread) + 1;
  return Math.max(0, s.rise * (s.count - step));
}

/* ------------------------------------------------------------------ the fire */

export interface Scenario {
  id: string;
  label: string;
  origin: RoomId;
  blurb: string;
}

export const SCENARIOS: Scenario[] = [
  { id: "cafe-kitchen", label: "Kitchen fire in the Cafeteria", origin: "cafe", blurb: "The east fire exit is inside the fire room." },
  { id: "corridor", label: "Electrical fire in the Central Corridor", origin: "lobby", blurb: "The main route to the main exit fills first." },
  { id: "lab-gas", label: "Gas fire in Chemistry Lab 1A", origin: "sec", blurb: "Smoke pushes into the corridor from the west." },
  { id: "library", label: "Fire in the Library stacks", origin: "library", blurb: "The west fire exit is inside the fire room." },
  { id: "hall", label: "Fire in the Main Hall", origin: "atrium", blurb: "Cuts the north wing off from the main entrance." },
  { id: "lecture", label: "Fire in the Lecture Theatre", origin: "lecture", blurb: "Smoke fills the north corridor that the whole wing depends on." },
  { id: "complab", label: "Electrical fire in the Computer Lab", origin: "complab", blurb: "Starts in the middle of the north wing." },
  { id: "gym", label: "Fire in the Sports Hall store", origin: "gym", blurb: "The north fire exit is inside the fire room." },
];

/** Doorway hops from the fire, through indoor rooms only. */
export function hopsFrom(origin: RoomId): Record<string, number> {
  const hops: Record<string, number> = { [origin]: 0 };
  const queue: RoomId[] = [origin];
  while (queue.length) {
    const room = queue.shift()!;
    for (const link of linksOf(room)) {
      const next = otherSide(link, room);
      if (next === "outside" || next in hops) continue;
      hops[next] = hops[room] + 1;
      queue.push(next);
    }
  }
  return hops;
}

const SPREAD = [
  { start: 0, rise: 28, peak: 1 },
  { start: 14, rise: 34, peak: 0.8 },
  { start: 32, rise: 40, peak: 0.55 },
  { start: 55, rise: 45, peak: 0.35 },
  { start: 80, rise: 50, peak: 0.2 },
];

/** Smoke from 0 (clear) to 1 (thick) in a room, `t` seconds after ignition. */
export function smokeAt(room: RoomId, t: number, hops: Record<string, number>) {
  if (room === "outside" || !(room in hops)) return 0;
  const step = SPREAD[Math.min(hops[room], SPREAD.length - 1)];
  const p = Math.max(0, Math.min(1, (t - step.start) / step.rise));
  return step.peak * p * p * (3 - 2 * p);
}

export const smokeWord = (s: number) => (s < 0.08 ? "clear" : s < 0.3 ? "light haze" : s < 0.6 ? "thick smoke" : "very thick, choking smoke");

/** A small, fixed hot spot inside the origin room where the flames are. */
export function fireSpot(origin: RoomId): P2 {
  const spots: Partial<Record<RoomId, P2>> = {
    cafe: [15, -22.25], // open floor in front of the serving counter
    lobby: [-3.8, -4.5],
    sec: [-19.5, -4.4],
    library: [-17.2, -21],
    atrium: [4.5, -21.5],
    lecture: [-19, -40],
    complab: [3.5, -40.5],
    gym: [19.5, -40.5],
  };
  return spots[origin] ?? roomCenter(origin);
}
