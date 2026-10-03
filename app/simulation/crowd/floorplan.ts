import { ROOM_H, type WallDef } from "../level";
import type { Link, P2, Plan, PlanRoom, Scenario } from "./world";

/**
 * A school floor from a few numbers: how many classrooms, how many students in each, which
 * other rooms, and where the exits are. Laid out the way most schools are: one corridor down
 * the middle, rooms on both sides, the entrance in the middle of the south side, and a fire
 * exit at each end of the corridor unless you take them away.
 *
 * `planFor` is pure: the same spec always gives the same building, so a recorded drill can
 * rebuild the floor it was run in.
 */

/** One room on the floor, as entered in the designer. */
export interface RoomEntry {
  kind: RoomKind;
  name: string;
  people: number;
}

export type RoomKind = "classroom" | "lab" | "library" | "cafeteria" | "hall" | "office";

/** What each kind of room is called, and how wide it is along the corridor. */
export const ROOM_KINDS: Record<RoomKind, { label: string; width: number; people: number }> = {
  classroom: { label: "Classroom", width: 8, people: 25 },
  lab: { label: "Lab", width: 8, people: 20 },
  library: { label: "Library", width: 12, people: 8 },
  cafeteria: { label: "Cafeteria", width: 12, people: 12 },
  hall: { label: "Hall", width: 14, people: 10 },
  office: { label: "Staff room", width: 6, people: 4 },
};

export interface BuildingSpec {
  /** the rooms, one by one; without it, the quick settings below make the list */
  rooms?: RoomEntry[];
  classrooms: number;
  studentsPerClassroom: number;
  library: boolean;
  lab: boolean;
  cafeteria: boolean;
  hall: boolean;
  staffroom: boolean;
  /** fire exits at both ends of the corridor; without them the main entrance is the only way out */
  endExits: boolean;
  /** the west fire exit opens onto steps */
  steppedExit: boolean;
}

export const DEFAULT_SPEC: BuildingSpec = {
  classrooms: 6,
  studentsPerClassroom: 25,
  library: true,
  lab: true,
  cafeteria: false,
  hall: false,
  staffroom: true,
  endExits: true,
  steppedExit: true,
};

export const LIMITS = { classrooms: [2, 12], students: [5, 40], rooms: 16, perRoom: 60 } as const;

/** The quick settings as a room list: numbered classrooms, then the other rooms ticked. */
export function presetRooms(spec: BuildingSpec): RoomEntry[] {
  const rooms: RoomEntry[] = Array.from({ length: spec.classrooms }, (_, i) => ({ kind: "classroom", name: `Classroom ${i + 1}`, people: spec.studentsPerClassroom }));
  if (spec.library) rooms.push({ kind: "library", name: "Library", people: 8 });
  if (spec.lab) rooms.push({ kind: "lab", name: "Science Lab", people: Math.round(spec.studentsPerClassroom * 0.8) });
  if (spec.cafeteria) rooms.push({ kind: "cafeteria", name: "Cafeteria", people: 12 });
  if (spec.hall) rooms.push({ kind: "hall", name: "Assembly Hall", people: 10 });
  if (spec.staffroom) rooms.push({ kind: "office", name: "Staff Room", people: 4 });
  return rooms;
}

export const roomsOf = (spec: BuildingSpec) => spec.rooms ?? presetRooms(spec);

const CORRIDOR = 4; // wide
const DEPTH = 8; // rooms run 8 m back from the corridor
const DOOR = 1.4;
const IN = "#e7dde4";
const OUT = "#c9bac8";

interface Slot {
  id: string;
  name: string;
  kind: NonNullable<PlanRoom["kind"]>;
  width: number;
  people: number;
}

/** A short, stable name for a floor: the same rooms and exits always give the same id. */
function specId(spec: BuildingSpec) {
  const text = JSON.stringify([roomsOf(spec), spec.endExits, spec.steppedExit]);
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return `floor-${(hash >>> 0).toString(36)}`;
}

/** Names must be told apart in orders: a second "Classroom 1" becomes "Classroom 1 (2)". */
function uniqueNames(rooms: RoomEntry[]) {
  const seen = new Map<string, number>();
  return rooms.map((room) => {
    const name = room.name.trim() || ROOM_KINDS[room.kind].label;
    const n = (seen.get(name.toLowerCase()) ?? 0) + 1;
    seen.set(name.toLowerCase(), n);
    return { ...room, name: n > 1 ? `${name} (${n})` : name };
  });
}

export function planFor(spec: BuildingSpec): Plan {
  const slots: Slot[] = uniqueNames(roomsOf(spec).slice(0, LIMITS.rooms)).map((room, i) => ({
    id: `r${i + 1}`,
    name: room.name,
    kind: room.kind,
    width: ROOM_KINDS[room.kind].width,
    people: Math.max(0, Math.min(LIMITS.perRoom, Math.round(room.people))),
  }));

  // fill the two sides evenly, biggest rooms first; the entrance goes in the middle of the south side
  const north: Slot[] = [];
  const south: Slot[] = [];
  const length = (side: Slot[]) => side.reduce((n, slot) => n + slot.width, 0);
  for (const slot of [...slots].sort((a, b) => b.width - a.width)) (length(north) <= length(south) ? north : south).push(slot);
  // keep classrooms in number order along each side, the way a corridor reads
  const byName = (a: Slot, b: Slot) => a.id.localeCompare(b.id, undefined, { numeric: true });
  north.sort(byName);
  south.sort(byName);
  south.splice(Math.floor(south.length / 2), 0, { id: "entry", name: "Main Entrance", kind: "entrance", width: 6, people: 1 });

  const span = Math.max(length(north), length(south)) + 2;
  const x0 = -span / 2;
  const x1 = span / 2;
  const nZ = -CORRIDOR / 2 - DEPTH;
  const sZ = CORRIDOR / 2 + DEPTH;

  const rooms: PlanRoom[] = [{ id: "corr", name: "Main Corridor", kind: "corridor", bounds: { minX: x0, maxX: x1, minZ: -CORRIDOR / 2, maxZ: CORRIDOR / 2 }, height: ROOM_H, people: 0 }];
  const links: Link[] = [];
  const walls: WallDef[] = [];
  const doorsN: number[] = [];
  const doorsS: number[] = [];
  const fireSpots: Record<string, P2> = {};

  const placeSide = (side: Slot[], isNorth: boolean) => {
    let x = x0;
    side.forEach((slot, i) => {
      // the last room on a side runs to the end of the corridor, so there is no dead space
      const right = i === side.length - 1 ? x1 : x + slot.width + (i === 0 ? 1 : 0);
      const bounds = isNorth ? { minX: x, maxX: right, minZ: nZ, maxZ: -CORRIDOR / 2 } : { minX: x, maxX: right, minZ: CORRIDOR / 2, maxZ: sZ };
      rooms.push({ id: slot.id, name: slot.name, kind: slot.kind, bounds, height: ROOM_H, people: slot.people });
      const cx = (x + right) / 2;
      const wallZ = isNorth ? -CORRIDOR / 2 : CORRIDOR / 2;
      const inward = isNorth ? -1 : 1;
      (isNorth ? doorsN : doorsS).push(cx);
      links.push({
        id: `${slot.id}-corr`,
        a: slot.id,
        b: "corr",
        door: [cx, wallZ],
        pa: [cx, wallZ + inward * 1.4],
        pb: [cx, wallZ - inward * 0.9],
        sign: { fromA: "CORRIDOR", fromB: slot.kind === "entrance" ? "MAIN ENTRANCE, green EXIT sign beyond" : slot.name.toUpperCase() },
      });
      fireSpots[slot.id] = [cx + (right - x) * 0.2, isNorth ? nZ + 2.5 : sZ - 2.5];
      if (slot.kind === "entrance")
        links.push({ id: "main-exit", a: "entry", b: "outside", door: [cx, sZ], pa: [cx, sZ - 1.4], pb: [cx, sZ + 5], exit: "main", sign: { fromA: "MAIN EXIT doors to the playground", fromB: "main entrance" } });
      if (i > 0) walls.push({ id: `p-${slot.id}`, axis: "z", fixed: x, from: isNorth ? nZ : CORRIDOR / 2, to: isNorth ? -CORRIDOR / 2 : sZ, color: IN });
      x = right;
    });
  };
  placeSide(north, true);
  placeSide(south, false);
  fireSpots.corr = [x0 + span * 0.3, 0];

  if (spec.endExits) {
    links.push({ id: "west-exit", a: "corr", b: "outside", door: [x0, 0], pa: [x0 + 1.4, 0], pb: [x0 - 5, 0], exit: "west", steps: spec.steppedExit, sign: { fromA: `FIRE EXIT (west), green running-man sign${spec.steppedExit ? ", steps down outside" : ""}`, fromB: "corridor" } });
    links.push({ id: "east-exit", a: "corr", b: "outside", door: [x1, 0], pa: [x1 - 1.4, 0], pb: [x1 + 5, 0], exit: "east", sign: { fromA: "FIRE EXIT (east), green running-man sign", fromB: "corridor" } });
  }
  const entry = rooms.find((room) => room.id === "entry")!;
  const entryX = (entry.bounds.minX + entry.bounds.maxX) / 2;

  walls.push(
    { id: "outer-n", axis: "x", fixed: nZ, from: x0 - 0.15, to: x1 + 0.15, color: OUT },
    { id: "outer-s", axis: "x", fixed: sZ, from: x0 - 0.15, to: x1 + 0.15, color: OUT, openings: [{ at: entryX, width: 2.4, height: 2.6 }] },
    { id: "outer-w", axis: "z", fixed: x0, from: nZ, to: sZ, color: OUT, openings: spec.endExits ? [{ at: 0, width: 1.8, height: 2.5 }] : [] },
    { id: "outer-e", axis: "z", fixed: x1, from: nZ, to: sZ, color: OUT, openings: spec.endExits ? [{ at: 0, width: 1.8, height: 2.5 }] : [] },
    { id: "corr-n", axis: "x", fixed: -CORRIDOR / 2, from: x0, to: x1, color: IN, openings: doorsN.map((at) => ({ at, width: DOOR, height: 2.4 })) },
    { id: "corr-s", axis: "x", fixed: CORRIDOR / 2, from: x0, to: x1, color: IN, openings: doorsS.map((at, i) => ({ at, width: south[i]?.kind === "entrance" ? 2.4 : DOOR, height: 2.4 })) },
  );

  // the fires an audit tries: the corridor, every special room, and the first, middle and last classroom
  const classrooms = rooms.filter((room) => room.kind === "classroom");
  const picked = new Set(["corr", ...rooms.filter((room) => room.kind !== "classroom" && room.kind !== "corridor" && room.kind !== "entrance").map((room) => room.id)]);
  for (const room of [classrooms[0], classrooms[Math.floor(classrooms.length / 2)], classrooms[classrooms.length - 1]]) if (room) picked.add(room.id);
  const scenarios: Scenario[] = rooms
    .filter((room) => picked.has(room.id))
    .map((room) => ({
      id: room.id,
      label: room.id === "corr" ? "Fire in the Main Corridor" : `Fire in the ${room.name}`,
      origin: room.id,
      blurb: room.id === "corr" ? "Smoke fills the one route every room depends on." : `Starts in the ${room.name}; ${room.people ?? 0} people are inside it.`,
    }));

  return {
    id: specId(spec),
    label: `${spec.classrooms} classrooms · ${rooms.reduce((n, room) => n + (room.people ?? 0), 0)} people`,
    demo: false,
    rooms,
    links,
    scenarios,
    fireSpots,
    bounds: { minX: x0, maxX: x1, minZ: nZ, maxZ: sZ },
    walls,
    spec: { ...spec },
  };
}

/** Everyone inside when the alarm goes. */
export const peopleIn = (plan: Plan) => plan.rooms.reduce((n, room) => n + (room.people ?? 0), 0);
