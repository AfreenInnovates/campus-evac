"use client";

import { create } from "zustand";
import { roomAt, roomById, type RoomId } from "../level";
import { cellOf, findPath, walkable, type NavGrid } from "./nav";
import { costOf, type CrowdTask } from "./prompts";
import { adoptRules, nextDrillNumber, standingOrders, usePlaybook } from "./playbook";
import { judge, parseTarget, type Order, type Target } from "./orders";
import { hasFix, type FixId } from "./fixes";
import { FIELDS, FRAME_EVERY, ORDER, PACE, STATUS, type Replay } from "./replay";
import {
  compass,
  farPoint,
  fireSpot,
  hopsFrom,
  INDOOR,
  isSafe,
  LINKS,
  linksOf,
  otherSide,
  placeName,
  roomCenter,
  SCENARIOS,
  signFrom,
  smokeAt,
  smokeWord,
  type Link,
  type P2,
  type Scenario,
} from "./world";

/**
 * The Crowd Lab's simulation and its agents' minds.
 *
 * Positions move every frame in plain mutable objects; React only sees a snapshot a few
 * times a second through `useLab`. Every decision a person makes is a real Nemotron call on
 * what that person can perceive from where they stand, and every announcement the warden
 * makes comes from a vision model reading a real camera frame, reasoned over by Nemotron.
 */

/* ------------------------------------------------------------------ people */

export type Pace = "walk" | "run" | "crawl";
export type Status = "inside" | "safe" | "down";
export type WardenMode = "ai" | "human" | "none";

export interface Persona {
  kind: string;
  /** how the person is described on screen */
  label?: string;
  icon?: string;
  blurb: string;
  speed: number;
  canRun: boolean;
  /** seconds before an announcement registers */
  hearingDelay: number;
  /** can get down on hands and knees under the smoke */
  canCrawl?: boolean;
  /** hears neither the alarm nor the PA: only sees what others do, and orders passed on in person */
  deaf?: boolean;
  /** freezes when the alarm goes and again when things get worse */
  panics?: boolean;
  /** needs a route with no steps */
  stepFree?: boolean;
}

const PERSONA: Record<string, Persona> = {
  calm: { kind: "calm", label: "calm student", icon: "🙂", blurb: "calm first-year student who follows official instructions carefully", speed: 1, canRun: true, hearingDelay: 0 },
  anxious: { kind: "anxious", label: "follows the crowd", icon: "👥", blurb: "anxious student who tends to follow whatever other people are doing", speed: 1.05, canRun: true, hearingDelay: 0 },
  sceptic: { kind: "sceptic", label: "lecturer", icon: "🧐", blurb: "lecturer who trusts what they can see over announcements", speed: 0.95, canRun: true, hearingDelay: 0 },
  wheelchair: {
    kind: "wheelchair",
    label: "wheelchair user",
    icon: "♿",
    blurb: "student who uses a manual wheelchair: you cannot run, cannot get down to crawl, and cannot go down steps",
    speed: 0.7,
    canRun: false,
    canCrawl: false,
    stepFree: true,
    hearingDelay: 0,
  },
  deaf: {
    kind: "deaf",
    label: "deaf",
    icon: "🧏",
    blurb: "deaf student: you hear neither the fire alarm nor announcements, so you rely on what you see and on people around you",
    speed: 1,
    canRun: true,
    deaf: true,
    hearingDelay: 0,
  },
  panic: {
    kind: "panic",
    label: "panics",
    icon: "😰",
    blurb: "student who panics in emergencies: your mind goes blank, you freeze, and you copy whoever is nearest",
    speed: 1.1,
    canRun: true,
    panics: true,
    hearingDelay: 0,
  },
  elderly: {
    kind: "elderly",
    label: "elderly, walks with a cane",
    icon: "🦯",
    blurb: "elderly visiting professor who walks with a cane: you cannot run or get down onto the floor",
    speed: 0.6,
    canRun: false,
    canCrawl: false,
    hearingDelay: 2,
  },
  visitor: { kind: "visitor", label: "first-time visitor", icon: "🧭", blurb: "visitor on their first day who has never been in this building", speed: 1, canRun: true, hearingDelay: 0 },
  headphones: { kind: "headphones", label: "wearing headphones", icon: "🎧", blurb: "student wearing noise-cancelling headphones who notices announcements late", speed: 1, canRun: true, hearingDelay: 7 },
};

/** The people real evacuation plans most often fail, so every drill includes some of them. */
const AT_RISK = ["wheelchair", "deaf", "panic", "elderly", "visitor", "headphones"];
const EVERYONE_ELSE = ["calm", "anxious", "sceptic", "calm", "anxious"];

function castPeople(count: number, random: () => number): Persona[] {
  const kinds = AT_RISK.slice(0, Math.min(AT_RISK.length, Math.ceil(count / 2)));
  while (kinds.length < count) kinds.push(EVERYONE_ELSE[Math.floor(random() * EVERYONE_ELSE.length)]);
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
  }
  return kinds.map((kind) => PERSONA[kind]);
}

/** What the warden's records say about a person, the way a real Personal Emergency Evacuation Plan would. */
export function needsOf(persona: Persona) {
  if (persona.stepFree) return `wheelchair user: needs a step-free route${fixed("ramp") ? "" : "; cannot use the WEST FIRE EXIT (steps)"}`;
  if (persona.deaf) return "deaf: cannot hear the alarm or the PA; an order only reaches them if someone in the same room passes it on";
  if (persona.kind === "elderly") return "elderly, walks with a cane: slow, cannot crawl";
  return "";
}

const NAMES = ["Asha", "Ben", "Chen", "Dara", "Eli", "Fatima", "Gus", "Hana", "Ivan", "Jia", "Kofi", "Lena", "Mateo", "Nia", "Omar", "Priya", "Quinn", "Rosa", "Sam", "Tariq"];
const COLORS = ["#ff6a3d", "#38bdf8", "#facc15", "#a78bfa", "#34d399", "#f472b6", "#fb923c", "#60a5fa", "#e879f9", "#4ade80", "#fbbf24", "#22d3ee", "#f87171", "#c084fc", "#2dd4bf", "#fda4af", "#93c5fd", "#bef264", "#fdba74", "#67e8f9"];

export interface Heard {
  t: number;
  text: string;
  direct: boolean;
  /** where a direct order told this person to go */
  target?: Target | null;
}

export interface Agent {
  id: number;
  name: string;
  color: string;
  persona: Persona;
  x: number;
  z: number;
  heading: number;
  room: RoomId;
  health: number;
  exposure: number;
  status: Status;
  pace: Pace;
  path: P2[] | null;
  leg: number;
  /** the doorway they are heading through, if any */
  via: Link | null;
  thought: string;
  action: string;
  deciding: boolean;
  decisions: number;
  lastDecisionAt: number;
  /** why they should think again at the next opportunity */
  wants: string | null;
  heard: Heard[];
  pendingHear: Heard[];
  visited: RoomId[];
  smokeSeen: number;
  /** stayed put with the door shut, low by a window, waiting for firefighters */
  sheltering: boolean;
  /** the warden's latest order to this person by name, and whether they are following it */
  order: Order | null;
  /** frozen in panic until this time */
  frozenUntil: number;
  frozenFor: number;
  /** when a deaf person realised something was wrong; null until they do */
  noticedAt: number | null;
  /** orders meant for this person that never reached them */
  missedOrders: number;
  /** where they reached a fire exit they could not use */
  blockedAt: string | null;
  endedAt: number | null;
  exit: string | null;
  history: { t: number; room: string; choice: string; thought: string }[];
}

/* ------------------------------------------------------------------ the run */

export interface LabConfig {
  scenarioId: string;
  agents: number;
  warden: WardenMode;
  seed: number;
  wardenEvery: number;
  /** give the AI warden the standing orders learned from earlier drills */
  playbook: boolean;
  /** changes made to the building or the plan, for testing whether they help */
  fixes?: FixId[];
}

export interface WardenTurn {
  t: number;
  image: string | null;
  report: string;
  /** Nemotron Super's own reasoning before it spoke */
  reasoning: string;
  assessment: string;
  broadcast: string;
  directives: { people: number[]; message: string; target: Target | null }[];
  ms: number;
  error?: string;
}

/** The moments the narrator says out loud. */
export type LabEvent =
  | { type: "start"; room: string; people: number }
  | { type: "out"; name: string; safe: number; people: number }
  | { type: "down"; name: string; room: string }
  | { type: "shelter"; name: string; room: string }
  | { type: "announce"; text: string; people: number[] | null }
  | { type: "end"; survived: number; people: number };

export interface LogEntry {
  event?: LabEvent;
  t: number;
  kind: "warden" | "agent" | "system" | "human";
  text: string;
  agent?: number;
}

export interface Usage {
  calls: number;
  failures: number;
  ms: number;
  cost: number;
  byTask: Partial<Record<CrowdTask, { calls: number; cost: number }>>;
}

export const MAX_RUN_SECONDS = 240;
/** Stop spending on a run past this, whatever happens. */
export const RUN_BUDGET_USD = 0.5;
const MAX_IN_FLIGHT = 5;
const WAIT_RETHINK = 9;
const SPEED: Record<Pace, number> = { walk: 1.35, run: 2.8, crawl: 0.6 };

export const lab = {
  config: null as LabConfig | null,
  scenario: null as Scenario | null,
  hops: {} as Record<string, number>,
  grid: null as NavGrid | null,
  agents: [] as Agent[],
  t: 0,
  running: false,
  finished: false,
  inFlight: 0,
  warden: [] as WardenTurn[],
  wardenBusy: false,
  nextWardenAt: 3,
  log: [] as LogEntry[],
  usage: { calls: 0, failures: 0, ms: 0, cost: 0, byTask: {} } as Usage,
  /** set by the canvas: renders the CCTV frame and returns it as a JPEG data URL */
  capture: null as null | (() => Promise<string | null>),
  runId: 0,
  /** the standing orders this run's warden was given, fixed at the start of the run */
  orders: "",
  playbookVersion: 0,
  ruleCount: 0,
  /** the last thing the warden said to each person by number, so it can stay consistent */
  told: new Map<number, { t: number; message: string }>(),
  /** the drill as it is being recorded */
  rec: { frames: [] as number[][], strings: new Map<string, number>(), thoughts: [] as string[], targets: [] as string[], targetIds: new Map<string, number>(), nextAt: 0 },
  /** a recorded drill being played back instead of a live one */
  playback: null as Replay | null,
  /** playback speed; live drills always run in real time */
  speed: 1,
};

/** Whether this run's building has a given fix in place. */
const fixed = (id: FixId) => hasFix(lab.config?.fixes, id);

/** A doorway this person physically cannot use: steps, for a wheelchair, unless they were ramped. */
const impassable = (agent: Agent, link: Link) => !!agent.persona.stepFree && !!link.steps && !fixed("ramp");

const indexOf = (table: string[], ids: Map<string, number>, text: string) => {
  let id = ids.get(text);
  if (id === undefined) {
    id = table.length;
    table.push(text);
    ids.set(text, id);
  }
  return id;
};

function recordFrame() {
  const rec = lab.rec;
  const frame = [Math.round(lab.t * 100) / 100];
  for (const a of lab.agents) {
    frame.push(
      Math.round(a.x * 100) / 100,
      Math.round(a.z * 100) / 100,
      Math.round(a.heading * 100) / 100,
      STATUS.indexOf(a.status),
      a.sheltering ? 1 : a.frozenUntil > lab.t ? 2 : 0,
      PACE.indexOf(a.pace),
      Math.round(a.health),
      Math.round(a.lastDecisionAt * 10) / 10,
      indexOf(rec.thoughts, rec.strings, a.thought),
      ORDER.indexOf(a.order?.status ?? ""),
      a.order ? indexOf(rec.targets, rec.targetIds, a.order.target.label) : -1,
    );
  }
  rec.frames.push(frame);
}

/** A seeded generator, so the same seed puts the same people in the same places. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

/** Where people can be when the alarm goes: anywhere indoors, more of them in the bigger rooms. */
const SPAWN_ROOMS = INDOOR.filter((room) => room !== "entry").map((room) => {
  const b = roomById(room).bounds;
  return { room, area: (b.maxX - b.minX) * (b.maxZ - b.minZ) };
});
const SPAWN_AREA = SPAWN_ROOMS.reduce((sum, r) => sum + r.area, 0);

function spawnRoom(random: () => number): RoomId {
  let pick = random() * SPAWN_AREA;
  for (const r of SPAWN_ROOMS) {
    pick -= r.area;
    if (pick <= 0) return r.room;
  }
  return SPAWN_ROOMS[0].room;
}

export function setupRun(config: LabConfig) {
  const scenario = SCENARIOS.find((item) => item.id === config.scenarioId) ?? SCENARIOS[0];
  const random = rng(config.seed);
  lab.runId++;
  lab.config = config;
  lab.scenario = scenario;
  lab.hops = hopsFrom(scenario.origin);
  lab.t = 0;
  lab.running = false;
  lab.finished = false;
  lab.inFlight = 0;
  lab.warden = [];
  lab.wardenBusy = false;
  lab.nextWardenAt = 3;
  lab.log = [];
  lab.usage = { calls: 0, failures: 0, ms: 0, cost: 0, byTask: {} };
  lab.agents = [];
  lab.told = new Map();
  lab.playback = null;
  lab.rec = { frames: [], strings: new Map(), thoughts: [], targets: [], targetIds: new Map(), nextAt: 0 };
  const playbook = usePlaybook.getState().playbook;
  const useOrders = config.warden === "ai" && config.playbook && playbook.rules.length > 0;
  lab.orders = useOrders ? standingOrders(playbook) : "";
  lab.playbookVersion = useOrders ? playbook.version : 0;
  lab.ruleCount = useOrders ? playbook.rules.length : 0;

  const grid = lab.grid;
  const cast = castPeople(config.agents, random);
  for (let i = 0; i < config.agents; i++) {
    const room = spawnRoom(random);
    const [cx, cz] = roomCenter(room);
    const b = roomById(room).bounds;
    let x = cx;
    let z = cz;
    // anywhere in the room on free floor, clear of the walls and of each other
    for (let attempt = 0; attempt < 60; attempt++) {
      const px = b.minX + 0.7 + random() * (b.maxX - b.minX - 1.4);
      const pz = b.minZ + 0.7 + random() * (b.maxZ - b.minZ - 1.4);
      if (roomAt(px, pz) !== room) continue;
      if (grid && !walkable(grid, ...cellOf(px, pz))) continue;
      if (lab.agents.some((other) => Math.hypot(other.x - px, other.z - pz) < 0.9)) continue;
      x = px;
      z = pz;
      break;
    }
    const persona = cast[i];
    lab.agents.push({
      id: i + 1,
      name: NAMES[i % NAMES.length],
      color: COLORS[i % COLORS.length],
      persona,
      x,
      z,
      heading: random() * Math.PI * 2,
      room,
      health: 100,
      exposure: 0,
      status: "inside",
      pace: "walk",
      path: null,
      leg: 0,
      via: null,
      thought: "…",
      action: persona.deaf && !fixed("strobes") ? "carries on, unaware of the alarm" : "hears the alarm",
      deciding: false,
      decisions: 0,
      lastDecisionAt: -99,
      // a deaf person does not know anything is wrong until they see it
      wants: persona.deaf && !fixed("strobes") ? null : persona.deaf ? "the fire alarm strobe lights just started flashing" : "the fire alarm just went off",
      heard: [],
      pendingHear: [],
      visited: [room],
      smokeSeen: 0,
      sheltering: false,
      order: null,
      frozenUntil: persona.panics ? (fixed("voice-alarm") ? 2 + random() * 2.5 : 4 + random() * 5) : 0,
      frozenFor: 0,
      noticedAt: persona.deaf && !fixed("strobes") ? null : 0,
      missedOrders: 0,
      blockedAt: null,
      endedAt: null,
      exit: null,
      history: [],
    });
  }
  note("system", `${scenario.label}. ${config.agents} people inside. Warden: ${config.warden === "ai" ? "AI (vision)" : config.warden === "human" ? "you" : "none"}.`, undefined, {
    type: "start",
    room: placeName(scenario.origin),
    people: config.agents,
  });
  publish(true);
}

function note(kind: LogEntry["kind"], text: string, agent?: number, event?: LabEvent) {
  lab.log.unshift({ t: lab.t, kind, text, agent, event });
  if (lab.log.length > 200) lab.log.length = 200;
}

/* ------------------------------------------------------------------ model calls */

async function callModel(task: CrowdTask, input: string, image?: string) {
  if (lab.usage.cost >= RUN_BUDGET_USD) throw new Error("run budget reached");
  const runId = lab.runId;
  const response = await fetch("/api/crowd", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ task, input, image }),
  });
  const body = (await response.json()) as { text?: string; reasoning?: string; json?: unknown; ms?: number; input?: number; output?: number; error?: string };
  if (runId !== lab.runId) throw new Error("stale");
  const entry = (lab.usage.byTask[task] ??= { calls: 0, cost: 0 });
  lab.usage.calls++;
  entry.calls++;
  // a failed call can still have spent tokens (e.g. a model that thought past its budget)
  const cost = costOf(task, body.input ?? 0, body.output ?? 0);
  lab.usage.cost += cost;
  entry.cost += cost;
  if (!response.ok || body.error) {
    lab.usage.failures++;
    throw new Error(body.error ?? `HTTP ${response.status}`);
  }
  lab.usage.ms += body.ms ?? 0;
  return body;
}

/* ------------------------------------------------------------------ perception */

const LETTERS = "ABCDEFG";

function healthWord(health: number) {
  return health > 80 ? "fine" : health > 55 ? "coughing" : health > 30 ? "struggling to breathe" : "dizzy and weak";
}

/** Everything one person can perceive right now, written the way they would experience it. */
function perceive(agent: Agent) {
  const t = lab.t;
  const here = agent.room;
  const smokeHere = smokeAt(here, t, lab.hops);
  const origin = lab.scenario!.origin;
  // in thick smoke you cannot read a sign or see past a doorway: you need someone to tell you
  // low-level glowing signs stay readable under smoke that hides the ones overhead
  const blind = smokeHere > (fixed("low-signs") ? 0.8 : 0.45);
  const persona = agent.persona;
  // a wheelchair cannot go down steps: that doorway is not an option, only a dead end in view
  const steps = linksOf(here).filter((link) => impassable(agent, link));
  if (steps.length && !agent.blockedAt) agent.blockedAt = placeName(here);
  const options = linksOf(here).filter((link) => !steps.includes(link)).map((link, i) => {
    const beyond = otherSide(link, here);
    const beyondSmoke = smokeAt(beyond, t, lab.hops);
    const heading = lab.agents.filter((other) => other !== agent && other.status === "inside" && other.via === link).length;
    const parts = [
      `${LETTERS[i]}) doorway to the ${compass([agent.x, agent.z], link.door)}, sign: ${blind ? "you cannot read it through the smoke" : `"${signFrom(link, here)}"`}`,
      beyond === "outside"
        ? blind
          ? "cooler air is coming through it"
          : "beyond it: open air outside"
        : blind
          ? beyond === origin && t > 4
            ? "an orange glow through the smoke"
            : "you cannot see past it"
          : `beyond it: ${smokeWord(beyondSmoke)}${beyond === origin && t > 4 ? ", flames visible through it" : ""}`,
    ];
    if (heading) parts.push(`${heading} ${heading === 1 ? "person is" : "people are"} heading through it`);
    const been = agent.visited.filter((room) => room === beyond).length;
    if (been) parts.push(been > 1 ? `you have already been there ${been} times and found no way out` : "you have been there before");
    return { link, text: parts.join(" — ") };
  });

  const others = lab.agents.filter((other) => other !== agent && other.status === "inside" && other.room === here);
  const crowd = others.length
    ? `${others.length} other ${others.length === 1 ? "person" : "people"} in this room${others.some((o) => o.pace === "run") ? ", some running" : ""}${others.every((o) => o.action.startsWith("waits")) ? ", all standing still" : ""}.`
    : "Nobody else is in this room.";

  const [fx, fz] = fireSpot(origin);
  const fireLine = here === origin && t > 2 ? `FLAMES in this room, to the ${compass([agent.x, agent.z], [fx, fz])} of you.` : "";
  const heard = agent.heard.slice(-3).reverse().map((h) => `- ${Math.round(t - h.t)}s ago${h.direct ? " (to you, by name)" : ""}: "${h.text}"`);

  return {
    options,
    room: here,
    text: [
      `You are ${agent.name}, a ${agent.persona.blurb}.`,
      `Time since the alarm: ${Math.round(t)} seconds. You feel ${healthWord(agent.health)}.`,
      `You are in: ${placeName(here)}. The air here: ${smokeWord(smokeHere)}.`,
      fireLine,
      crowd,
      `Ways out of this room that you can see:\n${options.map((o) => o.text).join("\n")}`,
      ...steps.map((link) => `There is also a ${link.exit} fire exit here, but it opens onto steps down: impossible in your wheelchair.`),
      persona.deaf
        ? heard.length
          ? `You are deaf. Messages someone passed on to you in person (newest first):\n${heard.join("\n")}`
          : `You are deaf: you hear nothing at all, no alarm and no announcement, so never say you heard something. You only know what you can see${fixed("strobes") ? ", and the fire alarm strobe lights are flashing" : ""}.`
        : heard.length
          ? `Announcements you have heard (newest first):\n${heard.join("\n")}`
          : fixed("voice-alarm")
            ? 'The alarm is a recorded voice: "Fire reported in the building. Leave now by the nearest exit, away from smoke."'
            : "You have not heard any announcement yet, only the alarm.",
      persona.panics ? "Your heart is pounding and it is hard to think straight; you badly want to do whatever the people nearest you are doing." : "",
      persona.canCrawl === false ? "You cannot get down onto the floor to crawl." : "",
      `Rooms you have been in, in order: ${agent.visited.map(placeName).join(" -> ")}.`,
      `Why you are deciding now: ${agent.wants ?? "checking your situation"}.`,
      agent.persona.canRun ? "" : "You cannot run.",
      agent.sheltering ? "You are sheltering here with the door shut." : "",
      `Options: ${options.map((_, i) => LETTERS[i]).join(", ")}, WAIT, or SHELTER (shut the door, stay low by a window and wait for firefighters: only if every way out is through smoke or flames).`,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

/* ------------------------------------------------------------------ deciding */

function goThrough(agent: Agent, link: Link) {
  const target = farPoint(link, agent.room);
  const path = lab.grid ? findPath(lab.grid, [agent.x, agent.z], target) : [target];
  if (!path) return false;
  agent.path = path;
  agent.leg = 0;
  agent.via = link;
  return true;
}

async function decide(agent: Agent) {
  const runId = lab.runId;
  agent.deciding = true;
  agent.lastDecisionAt = lab.t;
  const reason = agent.wants;
  agent.wants = null;
  lab.inFlight++;
  const seen = perceive(agent);
  try {
    const result = await callModel("evacuee", seen.text);
    if (runId !== lab.runId || agent.status !== "inside") return;
    const answer = (result.json ?? {}) as { thought?: string; choice?: string; pace?: string };
    const said = String(answer.choice ?? "WAIT").trim().toUpperCase();
    const shelter = said.startsWith("SHELTER");
    const index = shelter || said.startsWith("WAIT") ? -1 : LETTERS.indexOf(said.charAt(0));
    const option = index >= 0 ? seen.options[index] : null;
    const pace: Pace = answer.pace === "run" && agent.persona.canRun ? "run" : answer.pace === "crawl" && agent.persona.canCrawl !== false ? "crawl" : "walk";
    agent.thought = String(answer.thought ?? "").slice(0, 160) || "…";
    agent.decisions++;
    if (agent.order && agent.order.status !== "done") agent.order.status = judge(agent.order, seen.room, option?.link ?? null, shelter);
    agent.pace = pace;
    if (shelter) {
      agent.path = null;
      agent.via = null;
      agent.sheltering = true;
      agent.pace = agent.persona.canCrawl === false ? "walk" : "crawl";
      agent.action = `shelters in the ${placeName(agent.room)}`;
    } else if (option && goThrough(agent, option.link)) {
      agent.sheltering = false;
      const beyond = otherSide(option.link, agent.room);
      agent.action = `${pace === "run" ? "runs" : pace === "crawl" ? "crawls" : "walks"} to ${beyond === "outside" ? `the ${option.link.exit} exit` : placeName(beyond)}`;
    } else {
      agent.path = null;
      agent.via = null;
      agent.action = "waits";
    }
    agent.history.push({ t: Math.round(lab.t), room: placeName(agent.room), choice: agent.action, thought: agent.thought });
    note("agent", `${agent.name} (#${agent.id}) ${agent.action} — “${agent.thought}”`, agent.id, shelter ? { type: "shelter", name: agent.name, room: placeName(agent.room) } : undefined);
  } catch (error) {
    if (runId !== lab.runId) return;
    const message = (error as Error).message;
    agent.thought = message === "run budget reached" ? "(budget reached)" : "(could not think: model error)";
    // keep going on instinct: head for the nearest doorway that is not towards the fire
    if (!agent.path) {
      const escape = linksOf(agent.room).filter((link) => !impassable(agent, link)).sort((a, b) => smokeAt(otherSide(a, agent.room), lab.t, lab.hops) - smokeAt(otherSide(b, agent.room), lab.t, lab.hops))[0];
      if (escape) goThrough(agent, escape);
    }
    if (reason) agent.wants = null;
  } finally {
    if (runId === lab.runId) {
      agent.deciding = false;
      lab.inFlight = Math.max(0, lab.inFlight - 1);
    }
  }
}

/* ------------------------------------------------------------------ the warden */

const PLAN = (() => {
  const rooms = new Map<string, string[]>();
  for (const link of LINKS) {
    for (const [from, to] of [
      [link.a, link.b],
      [link.b, link.a],
    ] as const) {
      if (from === "outside") continue;
      const list = rooms.get(from) ?? [];
      list.push(to === "outside" ? `${link.exit?.toUpperCase()} EXIT to outside` : `${placeName(to)} (sign: "${signFrom(link, from)}")`);
      rooms.set(from, list);
    }
  }
  return [
    "Building plan (single storey). Compass: north is the top of the camera image, south the bottom, west the left, east the right. Evacuees use the same compass words.",
    ...[...rooms.entries()].map(([room, list]) => `- ${placeName(room as RoomId)} connects to: ${list.join("; ")}`),
    "Exits: MAIN EXIT (south, through the Main Entrance, step-free), WEST FIRE EXIT (Library west wall; WEST_STEPS), EAST FIRE EXIT (Cafeteria east wall, step-free), NORTH FIRE EXIT (Sports Hall north wall, step-free, out to the sports field). The north wing (Lecture Theatre, Computer Lab, Sports Hall) is reached only through the North Corridor, from the Main Hall or the Cafeteria. The Electrical Service room is a dead end.",
  ].join("\n");
})();

function deliver(text: string, people: number[] | null, kind: "warden" | "human", target: Target | null = null) {
  const clean = text.trim().slice(0, 240);
  if (!clean) return;
  for (const agent of lab.agents) {
    if (agent.status !== "inside") continue;
    const direct = !!people?.includes(agent.id);
    if (people && !direct) continue;
    if (agent.persona.deaf && fixed("text-alerts")) {
      agent.pendingHear.push({ t: lab.t + 3, text: `(text alert on your phone) ${clean}`, direct, target: direct ? target : null });
      continue;
    }
    if (agent.persona.deaf) {
      // the PA means nothing to them; an order by name only arrives if someone beside them passes it on
      if (!direct) continue;
      const helper = lab.agents.find((other) => other !== agent && other.status === "inside" && !other.persona.deaf && other.room === agent.room);
      if (!helper) {
        agent.missedOrders++;
        continue;
      }
      agent.pendingHear.push({ t: lab.t + 5, text: `(${helper.name} taps your shoulder and points, passing on the warden's message) ${clean}`, direct, target });
      continue;
    }
    // a spoken alarm system is louder and clearer than a bell: headphones let less of it slip by
    const delay = fixed("voice-alarm") ? Math.min(agent.persona.hearingDelay, 3) : agent.persona.hearingDelay;
    agent.pendingHear.push({ t: lab.t + delay, text: clean, direct, target: direct ? target : null });
  }
  note(kind, people ? `To #${people.join(", #")}: “${clean}”` : `PA: “${clean}”`, undefined, { type: "announce", text: clean, people });
}

export function humanBroadcast(text: string) {
  const people = [...text.matchAll(/#\s*(\d+)/g)].map((m) => Number(m[1])).filter((n) => lab.agents.some((a) => a.id === n));
  const message = people.length ? text.replace(/^[^:]*#\s*\d+[^:]*:\s*/, "") || text : text;
  if (people.length) {
    deliver(message, people, "human", parseTarget(message));
    for (const id of people) lab.told.set(id, { t: lab.t, message });
  } else deliver(text, null, "human");
  publish(true);
}

async function wardenTurn() {
  const runId = lab.runId;
  lab.wardenBusy = true;
  const t = lab.t;
  const turn: WardenTurn = { t, image: null, report: "", reasoning: "", assessment: "", broadcast: "", directives: [], ms: 0 };
  const started = performance.now();
  try {
    const image = (await lab.capture?.()) ?? null;
    if (!image) throw new Error("camera not ready");
    turn.image = image;
    const seen = await callModel("warden-see", `CCTV frame at ${Math.round(t)}s after the alarm.`, image);
    turn.report = (seen.text ?? "").slice(0, 1200);
    const previous = lab.warden.slice(-4).map((w) => `- at ${Math.round(w.t)}s: ${w.broadcast ? `"${w.broadcast}"` : "(no announcement)"}${w.directives.map((d) => ` / to #${d.people.join(",#")}: "${d.message}"`).join("")}`);
    const inside = lab.agents.filter((a) => a.status === "inside");
    const out = lab.agents.filter((a) => a.status === "safe");
    const unordered = inside.filter((a) => !lab.told.has(a.id));
    const status = [
      `Time since the alarm: ${Math.round(t)}s.`,
      `Roll call - still inside, not yet accounted for: ${inside.length ? inside.map((a) => `#${a.id} ${a.name}`).join(", ") : "nobody"}.`,
      ...inside.filter((a) => needsOf(a.persona)).map((a) => `Known needs (evacuation plan on file): #${a.id} ${a.name} - ${needsOf(a.persona)}.`),
      `Already out and safe (give them no more orders): ${out.length ? out.map((a) => `#${a.id}`).join(", ") : "nobody yet"}.`,
      unordered.length ? `Still inside with no personal order from you yet: ${unordered.map((a) => `#${a.id}`).join(", ")}.` : "",
    ]
      .filter(Boolean)
      .join("\n");
    const told = [...lab.told.entries()]
      .filter(([id]) => lab.agents.find((a) => a.id === id)?.status === "inside")
      .map(([id, said]) => `- #${id} (${Math.round(t - said.t)}s ago): "${said.message}"`);
    const memory = told.length
      ? `What you last told individual people who are still inside. Stay consistent with this; if you must change someone's instruction because the situation changed, say so plainly ("change of plan"):\n${told.join("\n")}`
      : "";
    const think = await callModel(
      "warden-think",
      [PLAN.replace("WEST_STEPS", fixed("ramp") ? "ramped, step-free" : "opens onto steps down, so no wheelchair can use it"), "", ...(lab.orders ? [lab.orders, ""] : []), status, ...(memory ? ["", memory] : []), "", "CCTV analyst report of the newest frame:", turn.report || "(no report)", "", previous.length ? `Your previous announcements:\n${previous.join("\n")}` : "You have made no announcements yet."].join("\n"),
    );
    if (runId !== lab.runId) return;
    turn.reasoning = think.reasoning ?? "";
    const answer = (think.json ?? {}) as { assessment?: string; broadcast?: string; directives?: { people?: unknown; message?: unknown; go_to?: unknown }[] };
    turn.assessment = String(answer.assessment ?? "").slice(0, 240);
    turn.broadcast = String(answer.broadcast ?? "").slice(0, 240);
    turn.directives = (Array.isArray(answer.directives) ? answer.directives : [])
      .map((d) => ({
        people: (Array.isArray(d.people) ? d.people : []).map(Number).filter((n) => Number.isInteger(n) && n > 0),
        message: String(d.message ?? "").slice(0, 160),
        target: parseTarget(String(d.go_to ?? "")) ?? parseTarget(String(d.message ?? "")),
      }))
      .map((d) => ({ ...d, people: d.people.filter((id) => lab.agents.find((a) => a.id === id)?.status === "inside") }))
      .filter((d) => d.people.length && d.message)
      .slice(0, 6);
    if (turn.broadcast) deliver(turn.broadcast, null, "warden");
    for (const directive of turn.directives) {
      deliver(directive.message, directive.people, "warden", directive.target);
      for (const id of directive.people) lab.told.set(id, { t, message: directive.message });
    }
    if (!turn.broadcast && !turn.directives.length) note("warden", `(no new announcement) ${turn.assessment}`);
  } catch (error) {
    if (runId !== lab.runId) return;
    turn.error = (error as Error).message;
    note("system", `Warden turn failed: ${turn.error}`);
  } finally {
    if (runId === lab.runId) {
      turn.ms = Math.round(performance.now() - started);
      lab.warden.push(turn);
      lab.wardenBusy = false;
      lab.nextWardenAt = lab.t + (lab.config?.wardenEvery ?? 12);
    }
  }
}

/* ------------------------------------------------------------------ the loop */

export function step(dt: number) {
  if (!lab.running || lab.finished || !lab.scenario) return;
  if (lab.playback) return playbackStep(dt);
  lab.t += dt;
  const t = lab.t;
  const [fx, fz] = fireSpot(lab.scenario.origin);

  for (const agent of lab.agents) {
    if (agent.status !== "inside") continue;

    // announcements land after the person's own delay
    if (agent.pendingHear.length && agent.pendingHear[0].t <= t) {
      const heard = agent.pendingHear.shift()!;
      agent.heard.push({ ...heard, t });
      if (heard.direct && heard.target) agent.order = { t, message: heard.text, target: heard.target, status: "heard" };
      agent.wants = heard.direct ? "the warden just spoke to you by name" : "a new announcement just played";
      // a calm voice saying your own name is what cuts through panic
      if (heard.direct && agent.frozenUntil > t) agent.frozenUntil = t;
      if (agent.noticedAt === null) agent.noticedAt = t;
    }

    // a deaf person only realises when they see people hurrying out, or smell the smoke
    if (agent.noticedAt === null) {
      const rushing = lab.agents.some((other) => other !== agent && other.status === "inside" && other.room === agent.room && other.path && other.via);
      if (rushing || smokeAt(agent.room, t, lab.hops) > 0.08) {
        agent.noticedAt = t;
        agent.wants = rushing ? "everyone around you has suddenly started hurrying out, and you do not know why" : "you smell smoke";
      }
    }

    const frozen = agent.frozenUntil > t;
    if (frozen) agent.frozenFor += dt;

    // walk the current path
    if (!frozen && agent.path && agent.leg < agent.path.length) {
      const [tx, tz] = agent.path[agent.leg];
      const dx = tx - agent.x;
      const dz = tz - agent.z;
      const dist = Math.hypot(dx, dz);
      const speed = SPEED[agent.pace] * agent.persona.speed * (agent.health < 30 ? 0.6 : 1);
      if (dist < 0.15) agent.leg++;
      else {
        const move = Math.min(dist, speed * dt);
        agent.x += (dx / dist) * move;
        agent.z += (dz / dist) * move;
        agent.heading = Math.atan2(dx, dz);
      }
      if (agent.leg >= agent.path.length) {
        agent.path = null;
        if (agent.via && otherSide(agent.via, agent.room) !== "outside") agent.wants = `you just arrived through the doorway`;
      }
    }

    // gentle separation so people do not stand inside each other
    for (const other of lab.agents) {
      if (other === agent || other.status !== "inside") continue;
      const dx = agent.x - other.x;
      const dz = agent.z - other.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.001 && d < 0.55) {
        const push = (0.55 - d) * 0.5;
        agent.x += (dx / d) * push;
        agent.z += (dz / d) * push;
      }
    }

    const room = roomAt(agent.x, agent.z);
    if (room !== agent.room) {
      agent.room = room;
      if (agent.order?.target.kind === "room" && agent.order.target.room === room) agent.order.status = "done";
      if (room !== "outside" && agent.visited[agent.visited.length - 1] !== room) agent.visited.push(room);
    }

    if (isSafe(agent.x, agent.z)) {
      agent.status = "safe";
      agent.endedAt = t;
      if (agent.order && agent.order.target.kind === "exit" && agent.order.target.link === agent.via) agent.order.status = "done";
      agent.exit = agent.via?.exit ?? (agent.z > 12 ? "main" : agent.z < -40 ? "north" : agent.x < 0 ? "west" : "east");
      agent.action = `safe via the ${agent.exit} exit`;
      note("system", `${agent.name} (#${agent.id}) is out, ${Math.round(t)}s, via the ${agent.exit} exit.`, agent.id, {
        type: "out",
        name: agent.name,
        safe: lab.agents.filter((a) => a.status === "safe").length,
        people: lab.agents.length,
      });
      continue;
    }
    // outside the walls but not yet clear: keep walking to the nearest exit's safe point
    if (room === "outside") {
      if (!agent.path) {
        const exits = LINKS.filter((link) => link.exit && !impassable(agent, link));
        const exit = agent.via?.exit ? agent.via : exits.sort((a, b) => Math.hypot(a.pb[0] - agent.x, a.pb[1] - agent.z) - Math.hypot(b.pb[0] - agent.x, b.pb[1] - agent.z))[0];
        agent.path = (lab.grid && findPath(lab.grid, [agent.x, agent.z], exit.pb)) || [exit.pb];
        agent.leg = 0;
      }
      continue;
    }

    // smoke and flames
    const smoke = smokeAt(room, t, lab.hops);
    const nearFire = room === lab.scenario.origin && Math.hypot(agent.x - fx, agent.z - fz) < 3.5 && t > 2;
    // a shut door and fresh air at the window cut the dose far more than crawling alone
    const breathe = smoke > 0.1 ? smoke * 1.5 * (agent.sheltering ? 0.2 : agent.pace === "crawl" ? 0.35 : 1) : 0;
    const burn = nearFire ? 7 : 0;
    agent.exposure += breathe * dt;
    agent.health = Math.max(0, agent.health - (breathe + burn) * dt);
    if (agent.health <= 0) {
      agent.status = "down";
      agent.endedAt = t;
      agent.action = "collapsed";
      note("system", `${agent.name} (#${agent.id}) collapsed in the ${placeName(room)} at ${Math.round(t)}s.`, agent.id, { type: "down", name: agent.name, room: placeName(room) });
      continue;
    }
    const bucket = smoke < 0.08 ? 0 : smoke < 0.3 ? 1 : smoke < 0.6 ? 2 : 3;
    if (bucket > agent.smokeSeen) {
      agent.smokeSeen = bucket;
      if (!agent.sheltering) agent.wants ??= "the smoke around you is getting worse";
      // thicker smoke can tip a panicking person back into freezing, unless someone has taken charge of them
      if (agent.persona.panics && bucket >= 2 && !agent.order) agent.frozenUntil = Math.max(agent.frozenUntil, t + 4);
    }
    if (agent.noticedAt !== null && !agent.path && !agent.wants && !agent.sheltering && t - agent.lastDecisionAt > WAIT_RETHINK) agent.wants = "you have been standing still for a while";
  }

  // think, a few people at a time; whoever has waited longest goes first
  if (lab.usage.cost < RUN_BUDGET_USD) {
    const ready = lab.agents
      .filter((agent) => agent.status === "inside" && agent.wants && !agent.deciding && agent.room !== "outside" && agent.frozenUntil <= t)
      .sort((a, b) => a.lastDecisionAt - b.lastDecisionAt);
    for (const agent of ready) {
      if (lab.inFlight >= MAX_IN_FLIGHT) break;
      void decide(agent);
    }
    if (lab.config?.warden === "ai" && !lab.wardenBusy && t >= lab.nextWardenAt) void wardenTurn();
  }

  if (t >= lab.rec.nextAt) {
    recordFrame();
    lab.rec.nextAt = t + FRAME_EVERY;
  }

  const moving = lab.agents.filter((agent) => agent.status === "inside" && !agent.sheltering).length;
  if (moving === 0 || t >= MAX_RUN_SECONDS) {
    recordFrame();
    lab.finished = true;
    lab.running = false;
    const sheltered = lab.agents.filter((agent) => agent.status === "inside" && agent.sheltering).length;
    note(
      "system",
      moving === 0
        ? `Everyone is accounted for at ${Math.round(t)}s${sheltered ? `: ${sheltered} sheltering inside for firefighters` : ""}.`
        : `Time limit reached: ${moving} still trying to get out${sheltered ? `, ${sheltered} sheltering` : ""}.`,
      undefined,
      { type: "end", survived: lab.agents.filter((a) => a.status === "safe" || (a.status === "inside" && a.sheltering)).length, people: lab.agents.length },
    );
    publish(true);
  } else publish(false);
}

/* ------------------------------------------------------------------ results */

export interface RunResult {
  id: string;
  at: number;
  scenario: string;
  warden: WardenMode;
  agents: number;
  seed: number;
  safe: number;
  /** alive inside, sheltering behind a shut door: survivors, counted apart from people who got out */
  sheltered: number;
  down: number;
  inside: number;
  seconds: number;
  meanEscape: number | null;
  meanExposure: number;
  exits: Record<string, number>;
  announcements: number;
  calls: number;
  cost: number;
  playbookVersion: number;
}

export function summarise(): RunResult | null {
  if (!lab.config || !lab.scenario) return null;
  const safe = lab.agents.filter((a) => a.status === "safe");
  const exits: Record<string, number> = {};
  for (const agent of safe) exits[agent.exit ?? "?"] = (exits[agent.exit ?? "?"] ?? 0) + 1;
  return {
    id: `${lab.runId}-${Date.now()}`,
    at: Date.now(),
    scenario: lab.scenario.label,
    warden: lab.config.warden,
    agents: lab.agents.length,
    seed: lab.config.seed,
    safe: safe.length,
    sheltered: lab.agents.filter((a) => a.status === "inside" && a.sheltering).length,
    down: lab.agents.filter((a) => a.status === "down").length,
    inside: lab.agents.filter((a) => a.status === "inside" && !a.sheltering).length,
    seconds: Math.round(lab.t),
    meanEscape: safe.length ? Math.round(safe.reduce((sum, a) => sum + (a.endedAt ?? 0), 0) / safe.length) : null,
    meanExposure: Math.round((lab.agents.reduce((sum, a) => sum + a.exposure, 0) / Math.max(1, lab.agents.length)) * 10) / 10,
    exits,
    announcements: lab.log.filter((entry) => entry.kind === "warden" || entry.kind === "human").length,
    calls: lab.usage.calls,
    cost: Math.round(lab.usage.cost * 10000) / 10000,
    playbookVersion: lab.playbookVersion,
  };
}

/** What went wrong for one person, in plain words, from what the simulation actually recorded. */
function troubleOf(a: Agent): string[] {
  const out: string[] = [];
  if (a.persona.deaf && a.noticedAt !== null && a.noticedAt > 5) out.push(`did not know there was a fire until ${Math.round(a.noticedAt)}s`);
  if (a.persona.deaf && a.noticedAt === null) out.push("never realised there was a fire");
  if (a.missedOrders) out.push(`${a.missedOrders} order${a.missedOrders === 1 ? "" : "s"} by name never reached them (nobody beside them to pass it on)`);
  if (a.frozenFor > 3) out.push(`froze in panic for ${Math.round(a.frozenFor)}s`);
  if (a.blockedAt) out.push(`reached the stepped fire exit in the ${a.blockedAt} and could not use it`);
  if (a.persona.hearingDelay >= 5 && a.heard.length) out.push(`heard announcements ${a.persona.hearingDelay}s late`);
  return out;
}

export interface Finding {
  id: number;
  name: string;
  color: string;
  icon: string;
  label: string;
  outcome: string;
  trouble: string[];
  failed: boolean;
}

/**
 * Who this evacuation plan failed: everyone who did not get out, and everyone at risk who did
 * but only after something went wrong. The most useful thing a drill can tell you.
 */
export function findings(): Finding[] {
  const out = lab.agents.filter((a) => a.status === "safe").map((a) => a.endedAt ?? 0).sort((a, b) => a - b);
  const median = out.length ? out[Math.floor(out.length / 2)] : 0;
  return lab.agents
    .map((a) => {
      const trouble = troubleOf(a);
      const failed = a.status === "down" || (a.status === "inside" && !a.sheltering);
      const slow = a.status === "safe" && median > 0 && (a.endedAt ?? 0) > median * 1.6;
      if (slow) trouble.push(`out last, at ${Math.round(a.endedAt ?? 0)}s (most were out by ${Math.round(median)}s)`);
      const outcome =
        a.status === "down"
          ? `collapsed in the ${placeName(a.room)} at ${Math.round(a.endedAt ?? 0)}s`
          : a.status === "safe"
            ? `got out via the ${a.exit} exit at ${Math.round(a.endedAt ?? 0)}s`
            : a.sheltering
              ? `sheltering in the ${placeName(a.room)}, waiting for firefighters`
              : `still inside the ${placeName(a.room)} when the drill ended`;
      return { id: a.id, name: a.name, color: a.color, icon: a.persona.icon ?? "", label: a.persona.label ?? a.persona.kind, outcome, trouble, failed };
    })
    .filter((f) => f.failed || f.trouble.length)
    .sort((a, b) => Number(b.failed) - Number(a.failed) || b.trouble.length - a.trouble.length);
}

/** One person's outcome in one audited drill. */
export interface AuditPerson {
  id: number;
  name: string;
  kind: string;
  label: string;
  icon: string;
  survived: boolean;
  status: Status;
  endedAt: number | null;
  /** where they ended up: the room they collapsed or got stuck in, or the exit they used */
  where: string;
  trouble: string[];
}

/** One drill of a building audit, condensed to what the audit report needs. */
export interface AuditDrill {
  at: number;
  fixes: FixId[];
  scenarioId: string;
  scenario: string;
  origin: RoomId;
  agents: number;
  survived: number;
  down: number;
  stuck: number;
  meanEscape: number | null;
  lastOut: number | null;
  exits: Record<string, number>;
  people: AuditPerson[];
  replayId: string | null;
  cost: number;
}

export function auditDrill(replayId: string | null): AuditDrill | null {
  const result = summarise();
  if (!result || !lab.scenario) return null;
  const out = lab.agents.filter((a) => a.status === "safe").map((a) => a.endedAt ?? 0);
  return {
    at: Date.now(),
    fixes: lab.config?.fixes ?? [],
    scenarioId: lab.scenario.id,
    scenario: lab.scenario.label,
    origin: lab.scenario.origin,
    agents: result.agents,
    survived: result.safe + result.sheltered,
    down: result.down,
    stuck: result.inside,
    meanEscape: result.meanEscape,
    lastOut: out.length ? Math.round(Math.max(...out)) : null,
    exits: result.exits,
    people: lab.agents.map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.persona.kind,
      label: a.persona.label ?? a.persona.kind,
      icon: a.persona.icon ?? "",
      survived: a.status === "safe" || (a.status === "inside" && a.sheltering),
      status: a.status,
      endedAt: a.endedAt === null ? null : Math.round(a.endedAt),
      where: a.status === "safe" ? `${a.exit} exit` : placeName(a.room),
      trouble: troubleOf(a),
    })),
    replayId,
    cost: result.cost,
  };
}

export interface Review {
  verdict?: string;
  coordination_score?: number;
  what_worked?: string[];
  what_failed?: string[];
  warden_clarity?: string;
  next_experiment?: string;
  playbook?: string[];
  playbook_change?: string;
  /** filled in here: what adopting the revised playbook actually changed */
  change?: { added: string[]; removed: string[]; note: string };
}

/**
 * The whole run, condensed for Nemotron Ultra to read. With `learn`, an AI-warden run also
 * rewrites the playbook the next drill's warden will be given.
 */
export async function debrief(learn = false): Promise<Review | null> {
  const result = summarise();
  if (!result) throw new Error("no run");
  const people = lab.agents.map(
    (a) =>
      `#${a.id} ${a.name} (${a.persona.label ?? a.persona.kind}) -> ${a.status}${a.endedAt ? ` at ${Math.round(a.endedAt)}s` : ""}${a.exit ? ` via ${a.exit}` : ""}; exposure ${Math.round(a.exposure)}.${troubleOf(a).map((x) => ` ${x}.`).join("")} Decisions: ${a.history
        .slice(0, 8)
        .map((h) => `[${h.t}s ${h.room}] ${h.choice} ("${h.thought}")`)
        .join(" ")}`,
  );
  const announcements = lab.log
    .filter((entry) => entry.kind === "warden" || entry.kind === "human")
    .reverse()
    .map((entry) => `[${Math.round(entry.t)}s] ${entry.text}`);
  const playbook = usePlaybook.getState().playbook;
  const input = [
    playbook.rules.length
      ? [
          `Current playbook (v${playbook.version})${lab.orders ? ", which this run's warden was given" : ", which this run's warden was NOT given"}:`,
          ...playbook.rules.map((r, i) => `${i + 1}. ${r.text}`),
        ].join("\n")
      : "Current playbook: empty.",
    "",
    `Scenario: ${result.scenario} (${lab.scenario?.blurb}). Warden: ${result.warden}. ${result.agents} people.`,
    `Outcome after ${result.seconds}s: ${result.safe} got out, ${result.sheltered} sheltered in place, ${result.down} collapsed, ${result.inside} still wandering inside. Exits used: ${JSON.stringify(result.exits)}. Mean time out: ${result.meanEscape ?? "n/a"}s.`,
    "",
    "Announcements:",
    announcements.length ? announcements.join("\n") : "(none)",
    "",
    "People:",
    ...people,
  ].join("\n");
  const answer = await callModel("debrief", input);
  publish(true);
  const review = answer.json as Review | null;
  if (learn && result.warden === "ai" && review && Array.isArray(review.playbook)) {
    review.change = adoptRules(review.playbook, nextDrillNumber(), String(review.playbook_change ?? ""));
  }
  return review;
}

/* ------------------------------------------------------------------ replays */

/** The finished drill as a replay. */
export function takeReplay(drill: number | null): Replay | null {
  const result = summarise();
  if (!result || !lab.config || lab.playback) return null;
  return {
    id: `${Date.now()}-${lab.runId}`,
    at: Date.now(),
    drill,
    config: lab.config,
    people: lab.agents.map((a) => ({ id: a.id, name: a.name, color: a.color, persona: a.persona })),
    frames: lab.rec.frames,
    thoughts: lab.rec.thoughts,
    targets: lab.rec.targets,
    log: lab.log.map(({ t, kind, text, agent, event }) => ({ t, kind, text, agent, event })),
    result,
  };
}

/** Load a recorded drill into the lab and start playing it. */
export function playReplay(replay: Replay) {
  const scenario = SCENARIOS.find((item) => item.id === replay.config.scenarioId) ?? SCENARIOS[0];
  lab.runId++;
  lab.config = replay.config;
  lab.scenario = scenario;
  lab.hops = hopsFrom(scenario.origin);
  lab.t = 0;
  lab.finished = false;
  lab.running = true;
  lab.inFlight = 0;
  lab.warden = [];
  lab.wardenBusy = false;
  lab.log = [];
  lab.usage = { calls: 0, failures: 0, ms: 0, cost: 0, byTask: {} };
  lab.orders = "";
  lab.playback = replay;
  lab.agents = replay.people.map((person) => ({
    ...person,
    persona: person.persona,
    x: 0,
    z: 0,
    heading: 0,
    room: "outside" as RoomId,
    health: 100,
    exposure: 0,
    status: "inside" as Status,
    pace: "walk" as Pace,
    path: null,
    leg: 0,
    via: null,
    thought: "…",
    action: "",
    deciding: false,
    decisions: 0,
    lastDecisionAt: -99,
    wants: null,
    heard: [],
    pendingHear: [],
    visited: [],
    smokeSeen: 0,
    sheltering: false,
    order: null,
    frozenUntil: 0,
    frozenFor: 0,
    noticedAt: 0,
    missedOrders: 0,
    blockedAt: null,
    endedAt: null,
    exit: null,
    history: [],
  }));
  applyFrame(0);
  publish(true);
}

function applyFrame(t: number) {
  const replay = lab.playback!;
  const frames = replay.frames;
  let i = 0;
  while (i < frames.length - 1 && frames[i + 1][0] <= t) i++;
  const a = frames[i];
  const b = frames[Math.min(i + 1, frames.length - 1)];
  const span = b[0] - a[0];
  const k = span > 0 ? Math.min(1, Math.max(0, (t - a[0]) / span)) : 0;
  lab.agents.forEach((agent, n) => {
    const o = 1 + n * FIELDS;
    agent.x = a[o] + (b[o] - a[o]) * k;
    agent.z = a[o + 1] + (b[o + 1] - a[o + 1]) * k;
    agent.heading = a[o + 2];
    agent.room = roomAt(agent.x, agent.z);
    agent.status = STATUS[a[o + 3]] ?? "inside";
    agent.sheltering = a[o + 4] === 1;
    agent.frozenUntil = a[o + 4] === 2 ? t + 1 : 0;
    agent.pace = PACE[a[o + 5]] ?? "walk";
    agent.health = a[o + 6];
    agent.lastDecisionAt = a[o + 7];
    agent.thought = replay.thoughts[a[o + 8]] ?? "…";
    agent.decisions = agent.thought === "…" ? 0 : 1;
    // moving between frames means there is somewhere to walk to
    agent.path = Math.hypot(b[o] - a[o], b[o + 1] - a[o + 1]) > 0.05 ? [[b[o], b[o + 1]]] : null;
    const status = ORDER[a[o + 9]];
    agent.order = status ? { t: 0, message: "", target: { kind: "recorded", label: replay.targets[a[o + 10]] ?? "" }, status } : null;
  });
}

function playbackStep(dt: number) {
  const replay = lab.playback!;
  lab.t += dt * lab.speed;
  applyFrame(lab.t);
  lab.log = replay.log.filter((entry) => entry.t <= lab.t);
  const end = replay.frames[replay.frames.length - 1]?.[0] ?? 0;
  if (lab.t >= end) {
    lab.finished = true;
    lab.running = false;
    publish(true);
  } else publish(false);
}

/* ------------------------------------------------------------------ UI snapshot */

export interface Snapshot {
  version: number;
  t: number;
  running: boolean;
  finished: boolean;
  agents: Pick<Agent, "id" | "name" | "color" | "room" | "health" | "status" | "pace" | "thought" | "action" | "deciding" | "decisions" | "persona" | "heard" | "sheltering" | "order" | "lastDecisionAt">[];
  warden: WardenTurn[];
  log: LogEntry[];
  usage: Usage;
  wardenBusy: boolean;
}

export const useLab = create<{ snap: Snapshot | null }>(() => ({ snap: null }));

let lastPublish = 0;
export function publish(force: boolean) {
  const now = performance.now();
  if (!force && now - lastPublish < 250) return;
  lastPublish = now;
  useLab.setState({
    snap: {
      version: now,
      t: lab.t,
      running: lab.running,
      finished: lab.finished,
      agents: lab.agents.map((a) => ({
        id: a.id,
        name: a.name,
        color: a.color,
        room: a.room,
        health: a.health,
        status: a.status,
        pace: a.pace,
        thought: a.thought,
        action: a.action,
        deciding: a.deciding,
        decisions: a.decisions,
        persona: a.persona,
        heard: a.heard,
        sheltering: a.sheltering,
        order: a.order ? { ...a.order } : null,
        lastDecisionAt: a.lastDecisionAt,
      })),
      warden: [...lab.warden],
      log: [...lab.log],
      usage: { ...lab.usage, byTask: { ...lab.usage.byTask } },
      wardenBusy: lab.wardenBusy,
    },
  });
}

export function setRunning(running: boolean) {
  if (lab.finished) return;
  lab.running = running;
  publish(true);
}
