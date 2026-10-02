import * as THREE from "three";
import {
  EVACUEE_SPAWN,
  type EquipmentId,
  type RoomId,
  type ScenarioObjectId,
} from "./level";

/** Keep physics stable when a tab wakes up after a frame hitch. */
export const clampDt = (dt: number) => Math.min(dt, 0.05);

/**
 * Per-frame state shared by the R3F systems. Durable drill state belongs to the
 * room authority; this object only holds render and input values.
 */
export const runtime = {
  evacuee: new THREE.Vector3(...EVACUEE_SPAWN),
  evacueeYaw: 0,
  sector: "entry" as RoomId,
  alert: 0,
  drillStartedAt: 0,
  hazardElapsed: 0,
  briefingStatus: "locked" as "locked" | "playing" | "complete",
  /** Authoritative evacuee transform received by a warden client. */
  netEvacuee: null as null | {
    x: number;
    y: number;
    z: number;
    yaw: number;
    hasBackpack: boolean;
    equipped: EquipmentId | null;
    scenarioProgress: Partial<Record<ScenarioObjectId, boolean>>;
  },
  /** What the action button can do at the current position. */
  useTarget: null as null | {
    kind: "intervention" | "assembly" | "scenario";
    id: string;
  },

  /* input shared by keyboard and coarse-pointer controls */
  jumpAt: -1e9,
  touchMove: { x: 0, y: 0 },
  /** Thumb pushed to the edge of the stick: the touch equivalent of holding Shift. */
  touchSprint: false,
  touchLook: { dx: 0, dy: 0 },
};
