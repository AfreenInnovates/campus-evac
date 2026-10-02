"use client";

import { create } from "zustand";
import {
  CRITICAL_SCENARIO_OBJECTS,
  newScenarioProgress,
  scenarioObjectById,
  scenarioReady,
  type EquipmentId,
  type RoomId,
  type ScenarioObjectId,
  type ScenarioProgress,
} from "./level";
import {
  BLOCKED_ROUTE,
  AIR_DRAIN_PER_SECOND,
  SMOKE_EXPOSURE_THRESHOLD,
  isRouteBlocked,
} from "./smoke";
import { REPORT_STEPS, splitFor, type DrillSummary } from "./report";
import type {
  CommandAcknowledgement,
  EvidenceRecord,
  LogEntry,
  RouteMessage,
  WardenState,
} from "./net/types";

export type ViewMode = "evacuee" | "warden" | "evidence";

/** How the evacuee sees the world: over the shoulder (default) or through their own eyes. */
export type CameraMode = "third" | "first";
export type BriefingStatus = "locked" | "playing" | "complete";

export type SimulationMode =
  | { kind: "solo" }
  | { kind: "evacuee" }
  | { kind: "warden"; sectorId: RoomId };

export const VIEWS: {
  id: ViewMode;
  n: string;
  title: string;
  blurb: string;
  color: string;
}[] = [
  {
    id: "evacuee",
    n: "1",
    title: "Evacuee View",
    blurb: "Immediate conditions, physical cues, and route messages only.",
    color: "#38bdf8",
  },
  {
    id: "warden",
    n: "2",
    title: "Warden Station",
    blurb: "One sector of evidence, verification, and bounded intervention.",
    color: "#10b981",
  },
  {
    id: "evidence",
    n: "3",
    title: "Evidence Review",
    blurb: "Inspect evidence age and confirm what is safe to communicate.",
    color: "#facc15",
  },
];

let logSeq = 0;

/**
 * Where completed objectives are reported for the drill record.
 *
 * `eventsNet.ts` already imports this module, so importing the session back here would
 * close an import cycle. The session registers a publisher when it joins a room and clears
 * it on disconnect, which also gives solo practice the behaviour it needs for free: with no
 * publisher registered, nothing is sent and no AWS configuration is required.
 */
type ProgressPublisher = (step: ScenarioObjectId, elapsed: number) => void;
let progressPublisher: ProgressPublisher | null = null;

export const setProgressPublisher = (publish: ProgressPublisher | null) => {
  progressPublisher = publish;
};


export interface SimulationState {
  mode: SimulationMode;
  view: ViewMode;
  /** Kept across drill resets so a player's choice sticks. */
  cameraMode: CameraMode;
  briefingStatus: BriefingStatus;
  /** Pause menu open: movement and interaction stop; solo also freezes the hazard clock. */
  paused: boolean;
  health: number;
  hasBackpack: boolean;
  equipped: EquipmentId | null;
  scenarioProgress: ScenarioProgress;
  air: number;
  smokeIntensity: number;
  hazardElapsed: number;
  /** Seconds into the drill at which each objective was completed; drives the report splits. */
  objectiveTimes: Partial<Record<ScenarioObjectId, number>>;
  /** Invalid actions attempted, e.g. leaving before the checklist was clear. */
  mistakes: { at: number; text: string }[];
  /** Low-water mark for air, kept because the live value recovers out of smoke. */
  lowestAir: number;
  /** When the first warden route message arrived, in drill seconds. */
  routeMessageAt: number | null;
  routeBlocked: boolean;
  routeStatus: "clear" | "unsafe" | "intervened";
  stamina: number;
  sector: RoomId;
  explored: Partial<Record<RoomId, boolean>>;
  evidence: Record<string, EvidenceRecord>;
  latestMessage: RouteMessage | null;
  lastAcknowledgement: CommandAcknowledgement | null;
  interventionApplied: boolean;
  assemblyProgress: number;
  assemblyConfirmed: boolean;
  failed: boolean;
  prompt: string | null;
  resetSeq: number;
  log: LogEntry[];

  setMode: (mode: SimulationMode) => void;
  beginBriefing: () => void;
  setPaused: (paused: boolean) => void;
  completeBriefing: () => void;
  setView: (view: ViewMode) => void;
  toggleCameraMode: () => void;
  interactScenario: (id: ScenarioObjectId) => void;
  setPrompt: (prompt: string | null) => void;
  enterSector: (sector: RoomId) => void;
  applySmokeExposure: (
    elapsedSeconds: number,
    intensity: number,
    dt: number,
  ) => void;
  receiveRouteMessage: (message: RouteMessage) => void;
  receiveAcknowledgement: (acknowledgement: CommandAcknowledgement) => void;
  applyIntervention: () => void;
  confirmAssembly: () => void;
  fail: (reason: string) => void;
  push: (text: string, tone?: LogEntry["tone"]) => void;
  reset: () => void;
  applyWardenState: (state: WardenState) => void;
}

const initial = {
  briefingStatus: "locked" as BriefingStatus,
  paused: false,
  air: 100,
  health: 72,
  hasBackpack: false,
  equipped: null as EquipmentId | null,
  scenarioProgress: newScenarioProgress(),
  smokeIntensity: 0,
  hazardElapsed: 0,
  objectiveTimes: {} as Partial<Record<ScenarioObjectId, number>>,
  mistakes: [] as { at: number; text: string }[],
  lowestAir: 100,
  routeMessageAt: null as number | null,
  routeBlocked: false,
  routeStatus: "clear" as const,
  stamina: 100,
  sector: "entry" as RoomId,
  explored: { outside: true, entry: true } as Partial<Record<RoomId, boolean>>,
  evidence: {} as Record<string, EvidenceRecord>,
  latestMessage: null as RouteMessage | null,
  lastAcknowledgement: null as CommandAcknowledgement | null,
  interventionApplied: false,
  assemblyProgress: 0,
  assemblyConfirmed: false,
  failed: false,
  prompt: null as string | null,
  log: [] as LogEntry[],
};

export const useSimulation = create<SimulationState>()((set, get) => ({
  mode: { kind: "solo" },
  view: "evacuee",
  cameraMode: "third",
  resetSeq: 0,
  ...initial,

  setMode: (mode) =>
    set({
      mode,
      briefingStatus: mode.kind === "warden" ? "complete" : "locked",
      view:
        mode.kind === "evacuee"
          ? "evacuee"
          : mode.kind === "warden"
            ? "warden"
            : get().view,
    }),

  beginBriefing: () => set({ briefingStatus: "playing" }),

  setPaused: (paused) => set((state) => (state.paused === paused ? state : { paused })),

  completeBriefing: () => {
    set({ briefingStatus: "complete" });
    get().push("Briefing complete. You can move now. Stay with the marked route.", "good");
  },

  setView: (view) => set({ view }),

  toggleCameraMode: () =>
    set((state) => ({ cameraMode: state.cameraMode === "third" ? "first" : "third" })),

  interactScenario: (id) => {
    const state = get();
    if (state.failed || state.assemblyConfirmed || state.scenarioProgress[id]) return;
    const object = scenarioObjectById(id);
    if (id === "main-exit") {
      const missing = CRITICAL_SCENARIO_OBJECTS.find((item) => !state.scenarioProgress[item]);
      if (missing) {
        const detail = scenarioObjectById(missing).label.toLowerCase();
        set((current) => ({
          mistakes: [...current.mistakes, { at: current.hazardElapsed, text: `Tried to exit before the ${detail}` }],
        }));
        get().push(`Exit locked. Resolve the ${detail} first.`, "bad");
        return;
      }
      set((current) => ({
        scenarioProgress: { ...current.scenarioProgress, [id]: true },
        objectiveTimes: { ...current.objectiveTimes, [id]: current.hazardElapsed },
      }));
      progressPublisher?.(id, get().hazardElapsed);
      get().confirmAssembly();
      return;
    }

    const progress = { ...state.scenarioProgress, [id]: true };
    const changes: Partial<SimulationState> = {
      scenarioProgress: progress,
      objectiveTimes: { ...state.objectiveTimes, [id]: state.hazardElapsed },
    };
    if (id === "emergency-backpack") {
      changes.hasBackpack = true;
      get().push("Emergency backpack secured. The radio is online.", "good");
    } else if (id === "lab-access-card") {
      changes.equipped = "access-card";
      get().push("Lab access card equipped. Look for the marked exit.", "good");
    } else if (id === "gas-valve") {
      changes.equipped = null;
      get().push("Gas isolation valve closed. The leak is no longer spreading.", "good");
    } else if (id === "first-aid-kit") {
      changes.health = Math.min(100, state.health + 28);
      get().push("First-aid kit used. Health restored.", "good");
    } else if (id === "lab-safety-clue") {
      changes.equipped = "emergency-guide";
      get().push("Clue decoded: west route, then the central exit.", "good");
    } else if (id === "academic-guide") {
      changes.equipped = "emergency-guide";
      get().push("Emergency guide decoded. The exit signs match the safe route.", "good");
    }
    set(changes);
    progressPublisher?.(id, get().hazardElapsed);
    if (scenarioReady(progress)) get().push("All critical steps complete. Return to the marked exit.", "good");
    else if (object.kind === "clue") get().push(`Next: ${nextScenarioObjective(progress)}.`, "info");
  },

  setPrompt: (prompt) => set((state) => (state.prompt === prompt ? state : { prompt })),

  push: (text, tone = "info") =>
    set((state) => {
      if (state.log[0]?.text === text && state.log[0]?.tone === tone) return state;
      return { log: [{ id: ++logSeq, text, tone }, ...state.log].slice(0, 6) };
    }),

  enterSector: (sector) => {
    if (get().sector === sector) return;
    const first = !get().explored[sector];
    set((state) => ({
      sector,
      explored: { ...state.explored, [sector]: true },
    }));
    if (first) get().push(`Entered ${sectorLabel(sector)}`, "info");
  },

  applySmokeExposure: (elapsedSeconds, intensity, dt) => {
    const state = get();
    const nextIntensity = Math.max(0, Math.min(1, intensity));
    const safeDt = Math.max(0, Math.min(0.25, dt));
    const exposure = nextIntensity > SMOKE_EXPOSURE_THRESHOLD ? nextIntensity : 0;
    const routeBlocked = isRouteBlocked(
      BLOCKED_ROUTE.from,
      BLOCKED_ROUTE.to,
      elapsedSeconds,
    );
    const airBefore = state.air;
    const healthBefore = state.health;
    const hazardBefore = state.smokeIntensity;
    const air = Math.max(0, airBefore - exposure * AIR_DRAIN_PER_SECOND * safeDt);
    const health = Math.max(0, healthBefore - exposure * 1.25 * safeDt);
    const routeStatus = state.interventionApplied
      ? "intervened"
      : routeBlocked
        ? "unsafe"
        : "clear";

    set({
      hazardElapsed: Math.max(0, elapsedSeconds),
      smokeIntensity: nextIntensity,
      routeBlocked,
      routeStatus,
      air,
      health,
      lowestAir: Math.min(state.lowestAir, air),
    });

    if (
      hazardBefore <= SMOKE_EXPOSURE_THRESHOLD &&
      nextIntensity > SMOKE_EXPOSURE_THRESHOLD
    )
      get().push("Smoke observed. Move toward clear air.", "bad");
    if (!state.routeBlocked && routeBlocked)
      get().push("East route is unsafe. Await or follow verified west guidance.", "bad");
    if (airBefore >= 35 && air < 35)
      get().push("Air is getting thin. Move toward clear air.", "bad");
    if (air === 0 && airBefore > 0) get().fail("air threshold reached");
    if (health === 0 && healthBefore > 0) get().fail("health threshold reached");
  },

  receiveRouteMessage: (message) => {
    set((state) => ({
      latestMessage: message,
      routeMessageAt: state.routeMessageAt ?? state.hazardElapsed,
    }));
    get().push(message.caption, "good");
  },

  receiveAcknowledgement: (acknowledgement) => {
    set({ lastAcknowledgement: acknowledgement });
    if (!acknowledgement.accepted)
      get().push(`Action denied: ${acknowledgement.reason ?? "not available"}.`, "bad");
  },

  applyIntervention: () => {
    set({ interventionApplied: true, routeStatus: "intervened" });
    get().push("Ventilation override accepted. Smoke is dispersing.", "good");
  },

  confirmAssembly: () => {
    if (get().failed || get().assemblyConfirmed) return;
    set({ assemblyConfirmed: true, assemblyProgress: 1 });
    get().push("Assembly confirmed. Training outcome recorded.", "good");
  },

  fail: (reason) => {
    if (get().failed || get().assemblyConfirmed) return;
    set({ failed: true });
    get().push(`Training outcome recorded: ${reason}.`, "bad");
  },

  reset: () => {
    logSeq = 0;
    set((state) => ({ ...initial, resetSeq: state.resetSeq + 1 }));
  },

  applyWardenState: (state) => {
    const evidence = Object.fromEntries(state.evidence.map((item) => [item.id, item]));
    set({
      hazardElapsed: state.hazardElapsed ?? 0,
      air: state.air,
      health: state.health,
      hasBackpack: state.hasBackpack,
      equipped: state.equipped,
      scenarioProgress: state.scenarioProgress,
      smokeIntensity: state.smokeIntensity,
      routeBlocked: state.routeStatus === "unsafe",
      routeStatus: state.routeStatus,
      sector: state.evacuee?.sectorId ?? get().sector,
      interventionApplied: state.interventionApplied,
      assemblyProgress: state.assemblyProgress,
      assemblyConfirmed: state.assemblyConfirmed,
      failed: state.failed,
      evidence,
      latestMessage: state.latestMessage,
      lastAcknowledgement: state.lastAcknowledgement,
      log: state.log,
    });
  },
}));

/** Snapshot of the finished run, in the shape the report endpoint expects. */
export function drillSummary(roomCode: string | null): DrillSummary {
  const state = useSimulation.getState();
  return {
    outcome: state.assemblyConfirmed ? "escaped" : "failed",
    durationSeconds: state.hazardElapsed,
    objectivesCompleted: CRITICAL_SCENARIO_OBJECTS.filter((id) => state.scenarioProgress[id]).length,
    objectivesTotal: CRITICAL_SCENARIO_OBJECTS.length,
    splits: REPORT_STEPS.map((id) => splitFor(id, state.objectiveTimes)),
    mistakes: state.mistakes,
    health: state.health,
    lowestAir: state.lowestAir,
    routeMessageAt: state.routeMessageAt,
    interventionApplied: state.interventionApplied,
    roomCode,
  };
}

function sectorLabel(sector: RoomId) {
  return {
    outside: "the plaza",
    entry: "the main entrance",
    lobby: "the central corridor",
    wcorr: "the Science Block passage",
    ecorr: "the Academic Block passage",
    sec: "Chemistry Lab 1A",
    vault: "Classroom A201",
    annex: "the electrical service room",
    atrium: "the Main Hall",
    library: "the library",
    cafe: "the cafeteria",
  }[sector];
}

export function nextScenarioObjective(progress: ScenarioProgress) {
  const next = CRITICAL_SCENARIO_OBJECTS.find((id) => !progress[id]);
  return next ? scenarioObjectById(next).label : "return to the marked exit";
}

/** Wardens follow the evacuee through the whole block; solo reveals sectors as they are explored. */
export function useSectorVisible(sector: RoomId): boolean {
  const warden = useSimulation((state) => state.mode.kind === "warden");
  const explored = useSimulation((state) => !!state.explored[sector]);
  return warden || explored;
}

export const watchedSector = (mode: SimulationMode): RoomId | null =>
  mode.kind === "warden" ? mode.sectorId : null;

/** The evacuee and solo practice own local movement and deterministic fallback simulation. */
export const useIsSimulationOwner = () =>
  useSimulation((state) => state.mode.kind === "solo" || state.mode.kind === "evacuee");
