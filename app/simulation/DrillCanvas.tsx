"use client";

import { lazy, memo, Suspense, useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { KeyboardControls, PerformanceMonitor } from "@react-three/drei";
import { Physics } from "@react-three/rapier";
import Building from "./components/Building";
import Exterior from "./components/Exterior";
import Rooms from "./components/Rooms";
import Interactables from "./components/Interactables";
import Evacuee from "./components/Evacuee";
import Systems from "./components/Systems";
import NetSync from "./components/NetSync";
import ViewRig from "./components/ViewRig";
import SmokeLayer from "./components/SmokeLayer";
import { reportStruggling, useGraphicsQuality } from "./graphics";
import { useIsSimulationOwner } from "./store";
import { useCoarsePointer } from "./useCoarsePointer";

/** Fetched only when the cinematic pass is on, so phones and the fast setting never download it. */
const Effects = lazy(() => import("./components/Effects"));

const MAP = [
  { name: "forward", keys: ["ArrowUp", "KeyW"] },
  { name: "back", keys: ["ArrowDown", "KeyS"] },
  { name: "left", keys: ["ArrowLeft", "KeyA"] },
  { name: "right", keys: ["ArrowRight", "KeyD"] },
  { name: "sprint", keys: ["ShiftLeft", "ShiftRight"] },
  { name: "use", keys: ["KeyE"] },
  { name: "jump", keys: ["Space"] },
  { name: "camera", keys: ["KeyV"] },
];

/**
 * Space is the jump key, and the browser has its own ideas about it: it scrolls
 * the page, and if the player last clicked a HUD button it re-presses that
 * button. Swallow it over the drill canvas, but leave it alone in a text field.
 */
function useSpaceForJumpOnly() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        el?.isContentEditable
      )
        return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

/** Memoised: the scene takes no props, so nothing the HUD re-renders should reach it. */
export default memo(function DrillCanvas() {
  const ownsSimulation = useIsSimulationOwner();
  const touch = useCoarsePointer();
  const quality = useGraphicsQuality(touch);
  // resolution steps down once if the frame rate cannot keep up, instead of stuttering on
  const [lean, setLean] = useState(false);
  useSpaceForJumpOnly();

  // A phone renders the same scene into a much denser display with a fraction of the GPU.
  // Shadow maps are the single most expensive thing here and the least missed at that size,
  // and capping DPR at 1 roughly halves the pixels on a 2x screen. Desktop is untouched.
  return (
    <KeyboardControls map={MAP}>
      <Canvas
        // three dropped PCFSoft (it falls back to PCF and warns every frame), so ask for PCF directly
        shadows={touch ? false : "percentage"}
        dpr={touch ? (lean ? 0.8 : 1) : lean ? 1 : [1, 1.5]}
        gl={{ antialias: !touch, powerPreference: "high-performance" }}
        // with the effect pass on, it tone maps as its last step instead of the renderer
        flat={quality === "high"}
        style={{ position: "absolute", inset: 0 }}
      >
        <PerformanceMonitor
          onDecline={() => {
            setLean(true);
            reportStruggling();
          }}
        />
        <Suspense fallback={null}>
          <ViewRig />
          {/* Only the evacuee/solo client steps physics; the warden receives a marker. */}
          <Physics gravity={[0, -18, 0]} paused={!ownsSimulation}>
            <Exterior />
            <Building />
            <Rooms />
            <Interactables />
            <Evacuee />
            {ownsSimulation && <Systems />}
          </Physics>
          <SmokeLayer touch={touch} />
          <NetSync />
          {quality === "high" && <Effects />}
        </Suspense>
      </Canvas>
    </KeyboardControls>
  );
});
