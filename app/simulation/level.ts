export type Vec3 = [number, number, number];

/* The compact authored block. IDs are stable across render, collision, and events. */
export type RoomId =
  | "outside"
  | "entry"
  | "lobby"
  | "wcorr"
  | "ecorr"
  | "sec"
  | "vault"
  | "annex"
  | "atrium"
  | "library"
  | "cafe"
  | "ncorr"
  | "lecture"
  | "complab"
  | "gym";

export type EquipmentId = "access-card" | "emergency-guide";
export type ScenarioObjectId =
  | "emergency-backpack"
  | "lab-access-card"
  | "gas-valve"
  | "first-aid-kit"
  | "lab-safety-clue"
  | "academic-guide"
  | "main-exit";

export type ScenarioObjectKind = "pickup" | "valve" | "clue" | "exit";
export type ScenarioProgress = Record<ScenarioObjectId, boolean>;

export interface ScenarioObjectDef {
  id: ScenarioObjectId;
  kind: ScenarioObjectKind;
  room: RoomId;
  label: string;
  sub: string;
  position: Vec3;
  color: string;
  radius: number;
}

export const WALL_T = 0.3;
export const ROOM_H = 3.8;

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface RoomDef {
  id: RoomId;
  name: string;
  blurb: string;
  bounds: Bounds;
  fog: boolean;
  floor: string;
  cam: { pos: Vec3; target: Vec3 };
  /** Ceiling height; the Main Hall is double height. Defaults to ROOM_H. */
  height?: number;
}

export const ATRIUM_H = 7.6;

/** Where the two fire exits sit along the west and east outer walls. */
export const WEST_EXIT_Z = -8.6;
export const EAST_EXIT_Z = -16.5;
/** The north wing, behind the Main Hall: a corridor, three big rooms, and a fire exit out of the Sports Hall. */
export const NORTH_EXIT_X = 14;
export const NORTH_Z = -43;
export const NCORR_Z = -29;

/**
 * The renderer retains the compact block foundation while the labels and
 * interaction catalog describe the CampusEvac topology.
 */
export const ROOMS: RoomDef[] = [
  {
    id: "outside",
    name: "Plaza / Assembly Point",
    blurb: "Safe staging area with the assembly beacon ahead.",
    bounds: { minX: -14, maxX: 14, minZ: 10.5, maxZ: 26 },
    fog: false,
    floor: "#2c2f33",
    cam: { pos: [0, 15, 33], target: [0, 2, 3] },
  },
  {
    id: "entry",
    name: "Main Entrance",
    blurb: "Notice wall and orientation point for the drill.",
    bounds: { minX: -3, maxX: 3, minZ: 7, maxZ: 10.5 },
    fog: false,
    floor: "#6e6a63",
    cam: { pos: [0, 11, 26], target: [0, 1.6, 6] },
  },
  {
    id: "lobby",
    name: "Central Corridor",
    blurb: "Primary route decision between the west and east stairs.",
    bounds: { minX: -5.5, maxX: 5.5, minZ: -7, maxZ: 7 },
    fog: true,
    floor: "#7b7770",
    cam: { pos: [0, 19.9, 14], target: [0, 0.6, 0] },
  },
  {
    id: "wcorr",
    name: "Science Block / Passage",
    blurb: "Candidate route to the outdoor assembly point.",
    bounds: { minX: -8, maxX: -5.5, minZ: 1, maxZ: 4 },
    fog: false,
    floor: "#6e6a63",
    cam: { pos: [-7, 9, 18], target: [-7, 1.4, 2] },
  },
  {
    id: "ecorr",
    name: "Academic Block / Passage",
    blurb: "Route edge that becomes unsafe during the scenario.",
    bounds: { minX: 5.5, maxX: 8, minZ: 1, maxZ: 4 },
    fog: false,
    floor: "#6e6a63",
    cam: { pos: [7, 9, 18], target: [7, 1.4, 2] },
  },
  {
    id: "sec",
    name: "Science Block / Chemistry Lab 1A",
    blurb: "Gas control, safety equipment, and the west exit route.",
    bounds: { minX: -22, maxX: -8, minZ: -7, maxZ: 7 },
    fog: true,
    floor: "#78746d",
    cam: { pos: [-1, 19.9, 0], target: [-15, 0.6, 0] },
  },
  {
    id: "vault",
    name: "Academic Block / Classroom A201",
    blurb: "Emergency guide, classroom clues, and the east route.",
    bounds: { minX: 8, maxX: 22, minZ: -7, maxZ: 7 },
    fog: true,
    floor: "#78746d",
    cam: { pos: [1, 19.9, 0], target: [15, 0.6, 0] },
  },
  {
    id: "annex",
    name: "Academic Block / Electrical Service",
    blurb: "Authored smoke origin and recovery route.",
    bounds: { minX: 13, maxX: 17, minZ: -10, maxZ: -7 },
    fog: false,
    floor: "#5d5a55",
    cam: { pos: [15, 9, 14], target: [15, 1.4, -7] },
  },
  {
    id: "atrium",
    name: "Main Hall",
    blurb: "Double-height hall north of the corridor. Smoke banks under its high ceiling.",
    bounds: { minX: -8, maxX: 8, minZ: -25, maxZ: -7 },
    fog: true,
    floor: "#5b5560",
    cam: { pos: [0, 24, -2], target: [0, 0.6, -16] },
    height: ATRIUM_H,
  },
  {
    id: "library",
    name: "Library",
    blurb: "Long stacks and reading tables off the west side of the Main Hall.",
    bounds: { minX: -22, maxX: -8, minZ: -25, maxZ: -7 },
    fog: true,
    floor: "#5a4b44",
    cam: { pos: [-4, 22, -8], target: [-15, 0.6, -16] },
  },
  {
    id: "cafe",
    name: "Cafeteria",
    blurb: "Open dining hall off the east side of the Main Hall.",
    bounds: { minX: 8, maxX: 22, minZ: -25, maxZ: -10 },
    fog: true,
    floor: "#565a5c",
    cam: { pos: [4, 22, -8], target: [15, 0.6, -17.5] },
  },
  {
    id: "ncorr",
    name: "North Wing / North Corridor",
    blurb: "Long corridor behind the Main Hall linking the north wing.",
    bounds: { minX: -22, maxX: 22, minZ: -29, maxZ: -25 },
    fog: true,
    floor: "#6e6a63",
    cam: { pos: [0, 18, -14], target: [0, 0.6, -27] },
  },
  {
    id: "lecture",
    name: "North Wing / Lecture Theatre",
    blurb: "Rows of seating facing a projection wall.",
    bounds: { minX: -22, maxX: -6, minZ: -43, maxZ: -29 },
    fog: true,
    floor: "#4f3f4a",
    cam: { pos: [-14, 22, -20], target: [-14, 0.6, -36] },
  },
  {
    id: "complab",
    name: "North Wing / Computer Lab",
    blurb: "Benches of workstations and a server cabinet.",
    bounds: { minX: -6, maxX: 6, minZ: -43, maxZ: -29 },
    fog: true,
    floor: "#5f6670",
    cam: { pos: [0, 22, -20], target: [0, 0.6, -36] },
  },
  {
    id: "gym",
    name: "North Wing / Sports Hall",
    blurb: "Open sprung-floor court with a fire exit to the north field.",
    bounds: { minX: 6, maxX: 22, minZ: -43, maxZ: -29 },
    fog: true,
    floor: "#9a7148",
    cam: { pos: [14, 22, -20], target: [14, 0.6, -36] },
    height: 5.2,
  },
];

export const roomHeight = (id: RoomId) => roomById(id).height ?? ROOM_H;

export function roomById(id: RoomId) {
  return ROOMS.find((room) => room.id === id)!;
}

/** The Main Hall's upper walkway along its north wall, reached by the central stair. */
export const MEZZANINE = { minX: -8, maxX: 8, minZ: -25, maxZ: -21.5, y: 3.9 };

/** How high a camera may rise at this spot: the room's ceiling, or the mezzanine above. */
export function ceilingAt(sector: RoomId, z: number, feetY: number) {
  if (sector === "atrium" && z < MEZZANINE.maxZ + 0.4 && feetY < MEZZANINE.y - 0.4) return MEZZANINE.y - 0.1;
  return roomHeight(sector);
}

export function roomAt(x: number, z: number): RoomId {
  for (const room of ROOMS) {
    if (room.id === "outside") continue;
    const bounds = room.bounds;
    if (
      x >= bounds.minX &&
      x <= bounds.maxX &&
      z >= bounds.minZ &&
      z <= bounds.maxZ
    )
      return room.id;
  }
  return "outside";
}

/* ------------------------------------------------------------------- walls */

export interface Opening {
  at: number;
  width: number;
  height?: number;
}

export interface WallDef {
  id: string;
  axis: "x" | "z";
  fixed: number;
  from: number;
  to: number;
  openings?: Opening[];
  height?: number;
  cutaway?: boolean;
  color?: string;
}

const OUT = "#c9bac8";
const IN = "#e7dde4";

export const WALLS: WallDef[] = [
  /* the old north face is now interior: lab | library, corridor | hall, classroom | service */
  { id: "w-north-w", axis: "x", fixed: -7, from: -22.15, to: -8, color: IN },
  {
    id: "w-north-c",
    axis: "x",
    fixed: -7,
    from: -8,
    to: 8,
    height: ATRIUM_H,
    color: IN,
    openings: [{ at: 0, width: 3.4, height: 3 }],
    // the overhead cameras look north into the hall over this wall, so drop it there
    cutaway: true,
  },
  {
    id: "w-north-e",
    axis: "x",
    fixed: -7,
    from: 8,
    to: 22.15,
    color: OUT,
    openings: [{ at: 15, width: 3.6, height: 2.9 }],
  },
  /* the two fire exits: west out of the Library, east out of the Cafeteria */
  {
    id: "w-west",
    axis: "z",
    fixed: -22,
    from: -25.15,
    to: 7.15,
    color: OUT,
    openings: [{ at: WEST_EXIT_Z, width: 1.8, height: 2.5 }],
  },
  {
    id: "w-east",
    axis: "z",
    fixed: 22,
    from: -25.15,
    to: 7.15,
    color: OUT,
    openings: [{ at: EAST_EXIT_Z, width: 1.8, height: 2.5 }],
  },
  { id: "w-far-north-w", axis: "x", fixed: -25, from: -22.15, to: -8, color: IN },
  { id: "w-far-north-e", axis: "x", fixed: -25, from: 8, to: 22.15, color: IN, openings: [{ at: 20.6, width: 1.6, height: 2.4 }] },
  {
    id: "w-hall-n",
    axis: "x",
    fixed: -25,
    from: -8,
    to: 8,
    height: ATRIUM_H,
    color: IN,
    // under the mezzanine, through to the north wing
    openings: [{ at: -5.5, width: 2.4, height: 2.9 }],
  },
  /* the north wing */
  {
    id: "w-ncorr-n",
    axis: "x",
    fixed: NCORR_Z,
    from: -22.15,
    to: 22.15,
    color: IN,
    openings: [
      { at: -14, width: 2, height: 2.5 },
      { at: 0, width: 2, height: 2.5 },
      { at: 14, width: 2.2, height: 2.6 },
    ],
  },
  { id: "w-nw-west", axis: "z", fixed: -22, from: NORTH_Z - 0.15, to: -25.15, color: OUT },
  { id: "w-nw-east", axis: "z", fixed: 22, from: NORTH_Z - 0.15, to: -25.15, color: OUT },
  {
    id: "w-nw-north",
    axis: "x",
    fixed: NORTH_Z,
    from: -22.15,
    to: 22.15,
    height: 5.2,
    color: OUT,
    openings: [{ at: NORTH_EXIT_X, width: 1.8, height: 2.5 }],
  },
  { id: "w-lecture-e", axis: "z", fixed: -6, from: NORTH_Z, to: NCORR_Z, color: IN },
  { id: "w-gym-w", axis: "z", fixed: 6, from: NORTH_Z, to: NCORR_Z, height: 5.2, color: IN },
  {
    id: "w-hall-w",
    axis: "z",
    fixed: -8,
    from: -25,
    to: -7,
    height: ATRIUM_H,
    color: IN,
    openings: [{ at: -16, width: 2.6, height: 2.7 }],
  },
  {
    id: "w-hall-e",
    axis: "z",
    fixed: 8,
    from: -25,
    to: -7,
    height: ATRIUM_H,
    color: IN,
    openings: [{ at: -17.5, width: 2.6, height: 2.7 }],
  },
  { id: "w-cafe-s", axis: "x", fixed: -10, from: 8, to: 22, color: IN, cutaway: true },
  {
    id: "w-south-w",
    axis: "x",
    fixed: 7,
    from: -22.15,
    to: -3,
    color: OUT,
    cutaway: true,
  },
  {
    id: "w-south-e",
    axis: "x",
    fixed: 7,
    from: 3,
    to: 22.15,
    color: OUT,
    cutaway: true,
  },
  { id: "w-entry-w", axis: "z", fixed: -3, from: 7, to: 10.65, color: OUT },
  { id: "w-entry-e", axis: "z", fixed: 3, from: 7, to: 10.65, color: OUT },
  {
    id: "w-entry-s",
    axis: "x",
    fixed: 10.5,
    from: -3.15,
    to: 3.15,
    height: 3.2,
    color: OUT,
    openings: [{ at: 0, width: 3, height: 2.6 }],
  },
  { id: "w-annex-w", axis: "z", fixed: 13, from: -10.15, to: -7, color: OUT },
  { id: "w-annex-e", axis: "z", fixed: 17, from: -10.15, to: -7, color: OUT },
  {
    id: "w-sec-e",
    axis: "z",
    fixed: -8,
    from: -7,
    to: 7,
    color: IN,
    openings: [{ at: 2.5, width: 1.6, height: 2.4 }],
  },
  {
    id: "w-lobby-w",
    axis: "z",
    fixed: -5.5,
    from: -7,
    to: 7,
    color: IN,
    openings: [{ at: 2.5, width: 1.6, height: 2.4 }],
  },
  {
    id: "w-lobby-e",
    axis: "z",
    fixed: 5.5,
    from: -7,
    to: 7,
    color: IN,
    openings: [{ at: 2.5, width: 1.6, height: 2.4 }],
  },
  {
    id: "w-vault-w",
    axis: "z",
    fixed: 8,
    from: -7,
    to: 7,
    color: IN,
    openings: [{ at: 2.5, width: 1.6, height: 2.4 }],
  },
];

export const MASSES: { x1: number; z1: number; x2: number; z2: number }[] = [
  { x1: -8, z1: -7.15, x2: -5.5, z2: 1 },
  { x1: -8, z1: 4, x2: -5.5, z2: 7.15 },
  { x1: 5.5, z1: -7.15, x2: 8, z2: 1 },
  { x1: 5.5, z1: 4, x2: 8, z2: 7.15 },
  /* dead space either side of the service room, between the classroom and the cafeteria */
  { x1: 8.15, z1: -10, x2: 12.85, z2: -7.15 },
  { x1: 17.15, z1: -10, x2: 21.85, z2: -7.15 },
];

export const SLABS: {
  id: string;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  color: string;
  ceiling?: boolean;
  height?: number;
}[] = [
  { id: "main", x1: -22.15, z1: -7.15, x2: 22.15, z2: 7.15, color: "#d2c8d8", ceiling: true },
  { id: "entry", x1: -3.15, z1: 7.15, x2: 3.15, z2: 10.65, color: "#cfc3d2", ceiling: true },
  { id: "annex", x1: 12.85, z1: -10.15, x2: 17.15, z2: -7, color: "#b5aab9", ceiling: true },
  { id: "library", x1: -22.15, z1: -25.15, x2: -8, z2: -7.15, color: "#8a6a55", ceiling: true },
  { id: "atrium", x1: -8, z1: -25.15, x2: 8, z2: -7.15, color: "#8c8590", ceiling: true, height: ATRIUM_H },
  { id: "cafe", x1: 8, z1: -25.15, x2: 22.15, z2: -10.15, color: "#8f9496", ceiling: true },
  { id: "ncorr", x1: -22.15, z1: -29, x2: 22.15, z2: -25.15, color: "#cfc3d2", ceiling: true },
  { id: "lecture", x1: -22.15, z1: NORTH_Z - 0.15, x2: -6, z2: -29, color: "#5e4a57", ceiling: true },
  { id: "complab", x1: -6, z1: NORTH_Z - 0.15, x2: 6, z2: -29, color: "#a7adb5", ceiling: true },
  { id: "gym", x1: 6, z1: NORTH_Z - 0.15, x2: 22.15, z2: -29, color: "#b98a5a", ceiling: true, height: 5.2 },
];

/* ------------------------------------------------------------------- doors */

export interface DoorDef {
  id: string;
  label: string;
  room: RoomId;
  at: Vec3;
  axis: "x" | "z";
  width: number;
  height: number;
  color: string;
  swing: 1 | -1;
}

export const DOORS: DoorDef[] = [
  {
    id: "door-utility",
    label: "Utility access door",
    room: "wcorr",
    at: [-8, 0, 2.5],
    axis: "z",
    width: 1.6,
    height: 2.4,
    color: "#38bdf8",
    swing: 1,
  },
  {
    id: "door-dorm",
    label: "Dorm wing access door",
    room: "ecorr",
    at: [5.5, 0, 2.5],
    axis: "z",
    width: 1.6,
    height: 2.4,
    color: "#facc15",
    swing: -1,
  },
];

/** Physical scenario props. The player must read the environment, not chase HUD markers. */
export const SCENARIO_OBJECTS: ScenarioObjectDef[] = [
  {
    id: "emergency-backpack",
    kind: "pickup",
    room: "entry",
    label: "Emergency backpack",
    sub: "grab it before entering the block",
    position: [1.55, 0.3, 8.65],
    color: "#38bdf8",
    radius: 1.55,
  },
  {
    id: "lab-access-card",
    kind: "pickup",
    room: "sec",
    label: "Lab access card",
    sub: "opens the marked exit",
    position: [-9.65, 0.98, 2.55],
    color: "#facc15",
    radius: 1.5,
  },
  {
    id: "gas-valve",
    kind: "valve",
    room: "sec",
    label: "Gas isolation valve",
    sub: "close the valve before crossing the lab",
    position: [-19.45, 1.12, -4.35],
    color: "#ef4444",
    radius: 1.55,
  },
  {
    id: "first-aid-kit",
    kind: "pickup",
    room: "sec",
    label: "First-aid kit",
    sub: "use on pickup / one charge",
    position: [-20.5, 1.05, 4.75],
    color: "#fb7185",
    radius: 1.4,
  },
  {
    id: "lab-safety-clue",
    kind: "clue",
    room: "sec",
    label: "Lab safety clue",
    sub: "decode the marked west route",
    position: [-13.7, 1.12, -1.8],
    color: "#10b981",
    radius: 1.35,
  },
  {
    id: "academic-guide",
    kind: "clue",
    room: "vault",
    label: "Emergency route guide",
    sub: "compare the classroom map with the signs",
    position: [12.2, 0.8, 1.25],
    color: "#a78bfa",
    radius: 1.35,
  },
  {
    id: "main-exit",
    kind: "exit",
    room: "entry",
    label: "Marked exit",
    sub: "all critical steps must be complete",
    position: [0, 1.15, 10.2],
    color: "#39ff88",
    radius: 1.6,
  },
];

export const scenarioObjectById = (id: ScenarioObjectId) =>
  SCENARIO_OBJECTS.find((item) => item.id === id)!;

export const CRITICAL_SCENARIO_OBJECTS: ScenarioObjectId[] = [
  "emergency-backpack",
  "lab-access-card",
  "gas-valve",
  "first-aid-kit",
  "lab-safety-clue",
  "academic-guide",
];

export const newScenarioProgress = (): ScenarioProgress => ({
  "emergency-backpack": false,
  "lab-access-card": false,
  "gas-valve": false,
  "first-aid-kit": false,
  "lab-safety-clue": false,
  "academic-guide": false,
  "main-exit": false,
});

export const scenarioReady = (progress: ScenarioProgress) =>
  CRITICAL_SCENARIO_OBJECTS.every((id) => progress[id]);

export interface ScenarioGuidance {
  id: ScenarioObjectId | "complete";
  label: string;
  room: RoomId;
  instruction: string;
  color: string;
}

/** One actionable instruction at a time; the evacuee should never need to parse the whole checklist. */
export function nextScenarioGuidance(progress: ScenarioProgress): ScenarioGuidance {
  const id = CRITICAL_SCENARIO_OBJECTS.find((item) => !progress[item]);
  if (id === "emergency-backpack") return { id, label: "Emergency backpack", room: "entry", instruction: "Pick up the emergency backpack on the floor beside the bench, just inside the entrance.", color: "#38bdf8" };
  if (id === "lab-access-card") return { id, label: "Lab access card", room: "sec", instruction: "Walk into the corridor and take the west door marked SCIENCE BLOCK. The yellow card is on the desk beside that door.", color: "#facc15" };
  if (id === "gas-valve") return { id, label: "Gas isolation valve", room: "sec", instruction: "In Chemistry Lab 1A, go to the back-left corner. Close the red valve under the GAS SHUT-OFF sign.", color: "#ef4444" };
  if (id === "first-aid-kit") return { id, label: "First-aid kit", room: "sec", instruction: "Find the white first-aid kit on the small table under the green FIRST AID sign, next to the window.", color: "#fb7185" };
  if (id === "lab-safety-clue") return { id, label: "Lab safety clue", room: "sec", instruction: "Read the green safety note on the long lab bench in the middle of the room.", color: "#10b981" };
  if (id === "academic-guide") return { id, label: "Academic route guide", room: "vault", instruction: "Cross the corridor to the east door marked ACADEMIC BLOCK. The purple route guide is on the desk nearest the door in Classroom A201.", color: "#a78bfa" };
  return { id: "main-exit", label: "Marked exit", room: "entry", instruction: "All steps done. Go back to the corridor, walk south to the entrance and use the green EXIT doors.", color: "#39ff88" };
}

/** Threats are deliberately only rendered in the warden's view. */
export const SPECTATOR_THREATS = [
  {
    id: "gas-cloud",
    room: "sec" as RoomId,
    position: [-19.45, 1.35, -4.35] as Vec3,
    label: "UNSEEN GAS LEAK",
    sub: "evacuee has no direct visual confirmation",
    color: "#ef4444",
  },
  {
    id: "east-structural-risk",
    room: "ecorr" as RoomId,
    position: [5.62, 1.65, 2.5] as Vec3,
    label: "STRUCTURAL RISK",
    sub: "route becomes unsafe after the event escalates",
    color: "#facc15",
  },
] as const;

/* --------------------------------------------------------------- evidence */

export type Reveal = "warden" | "evidence";
export type MarkerKind = "evidence" | "intervention" | "route";

export interface MarkerDef {
  id: string;
  kind: MarkerKind;
  label: string;
  sub?: string;
  reveal: Reveal;
  room: RoomId;
  color: string;
  position: Vec3;
  labelOffset?: Vec3;
  rotationY?: number;
  source?: string;
  nextAction?: string;
}

export const C = {
  red: "#ef4444",
  yellow: "#facc15",
  blue: "#38bdf8",
  green: "#10b981",
  slate: "#334155",
};

/** Stable IDs are shared by the local fixtures, AppSync payloads, and renderer. */
export const MARKERS: MarkerDef[] = [
  {
    id: "east-route-evidence",
    kind: "evidence",
    label: "East route sensor",
    sub: "observed route block",
    reveal: "evidence",
    room: "sec",
    color: C.red,
    position: [-11.2, 1.3, 0.2],
    labelOffset: [0, 0.75, 0],
    source: "Utility sector sensor feed",
    nextAction: "Verify before sending route guidance.",
  },
  {
    id: "smoke-source-evidence",
    kind: "evidence",
    label: "Smoke source reading",
    sub: "observed 8 seconds ago",
    reveal: "evidence",
    room: "sec",
    color: C.yellow,
    position: [-19, 1.1, -4],
    labelOffset: [0, 0.75, 0],
    source: "Electrical service monitor",
    nextAction: "Compare the source with the route status.",
  },
  {
    id: "ventilation-panel",
    kind: "intervention",
    label: "Ventilation panel",
    sub: "one authorized intervention",
    reveal: "warden",
    room: "sec",
    color: C.blue,
    position: [-12.2, 2, -6.8],
    labelOffset: [0, 0.85, 0],
    source: "Utility control panel",
    nextAction: "Apply only after the route evidence is verified.",
  },
  {
    id: "west-route-sign",
    kind: "route",
    label: "WEST STAIR -> FOYER",
    sub: "green return route to the marked exit",
    reveal: "warden",
    room: "lobby",
    color: C.green,
    position: [-2.2, 2.5, 6.7],
    labelOffset: [0, 0.7, 0],
    source: "Physical route signage",
    nextAction: "Send the west route when the block is verified.",
  },
];

export const EVACUEE_SPAWN: Vec3 = [0, 1.1, 9];
export const ASSEMBLY_Z = 13.5;

/** Low sunset sun, behind the block to the north-east. Shared by the sky, key light and environment. */
export const SUN_DIRECTION: Vec3 = [0.5, 0.2, -0.84];

export function isRevealed(
  reveal: Reveal,
  view: string,
  observed: boolean,
): boolean {
  if (view === "evacuee") return false;
  if (reveal === "warden") return true;
  return view === "evidence" || observed;
}
