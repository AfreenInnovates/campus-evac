"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { runtime } from "../runtime";
import { useSession } from "../session";
import { useSimulation, useIsSimulationOwner } from "../store";
import type { EvacueeState } from "../net/types";

const PUBLISH_HZ = 12;

/** Converts local prediction into the small role-scoped state sent to the room. */
function readEvacueeState(version: number): EvacueeState {
  const sim = useSimulation.getState();
  return {
    kind: "evacuee",
    t: Date.now(),
    hazardElapsed: runtime.hazardElapsed,
    stateVersion: version,
    eventSequence: version,
    position: [
      runtime.evacuee.x,
      runtime.evacuee.y,
      runtime.evacuee.z,
      runtime.evacueeYaw,
    ],
    sectorId: runtime.sector,
    air: sim.air,
    health: sim.health,
    hasBackpack: sim.hasBackpack,
    equipped: sim.equipped,
    scenarioProgress: sim.scenarioProgress,
    smokeIntensity: sim.smokeIntensity,
    stamina: sim.stamina,
    routeStatus: sim.routeStatus,
    interventionApplied: sim.interventionApplied,
    assemblyProgress: sim.assemblyProgress,
    assemblyConfirmed: sim.assemblyConfirmed,
    failed: sim.failed,
    routeMessage: sim.latestMessage,
    log: sim.log,
  };
}

/**
 * Publishes the evacuee's state at a fixed rate from the render loop. Incoming
 * warden snapshots are applied by DrillShell, outside the canvas, so the HUD
 * stays live even when the 3D view has not mounted.
 */
export default function NetSync() {
  const ownsSimulation = useIsSimulationOwner();
  const inRoom = useSimulation((state) => state.mode.kind !== "solo");
  const publish = useSession((state) => state.publish);
  const acc = useRef(0);
  const version = useRef(0);

  useFrame((_, dt) => {
    if (!ownsSimulation || !inRoom) return;
    acc.current += dt;
    if (acc.current < 1 / PUBLISH_HZ) return;
    acc.current = 0;
    version.current += 1;
    publish(readEvacueeState(version.current));
  });

  return null;
}
