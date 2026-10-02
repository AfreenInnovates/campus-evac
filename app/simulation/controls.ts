"use client";

import { runtime } from "./runtime";
import { useSimulation } from "./store";
import { playSignal } from "./audio";
import { scenarioReady } from "./level";

/**
 * The two evacuee actions, in one place.
 *
 * A key press and a thumb on a button have to mean exactly the same thing, so
 * neither the keyboard subscription nor the on-screen buttons own this logic -
 * they both call in here.
 */

/** `E` / the INTERACT button: a visible panel or the assembly beacon. */
export function pressUse() {
  const sim = useSimulation.getState();
  if (sim.briefingStatus !== "complete" || sim.paused || sim.air <= 0 || sim.failed || sim.assemblyConfirmed) return;
  const target = runtime.useTarget;
  if (target?.kind === "intervention") {
    if (sim.mode.kind === "solo") sim.applyIntervention();
    else sim.push("The warden must authorize the ventilation intervention.", "info");
  } else if (target?.kind === "assembly") {
    if (scenarioReady(sim.scenarioProgress)) sim.confirmAssembly();
    else sim.push("The assembly point is not the exit. Follow the marked sequence first.", "info");
  } else if (target?.kind === "scenario") {
    sim.interactScenario(target.id as Parameters<typeof sim.interactScenario>[0]);
    playSignal("evidence");
  }
}

/** `Space` / the JUMP button: a small hop for route readability. */
export function pressJump() {
  const sim = useSimulation.getState();
  if (sim.briefingStatus !== "complete" || sim.paused || sim.air <= 0 || sim.failed || sim.assemblyConfirmed) return;
  runtime.jumpAt = performance.now();
  playSignal("jump");
}
