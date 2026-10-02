"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { pressJump, pressUse } from "../controls";
import { runtime } from "../runtime";
import { useSimulation } from "../store";

/**
 * Phone controls for the evacuee: a stick on the left thumb, look on the right.
 *
 * Both halves write straight into `runtime`, which is where the simulation
 * already reads input from - nothing here re-renders React per frame. Each
 * surface tracks its own pointer id, so a thumb on the stick and a thumb on the
 * look pad do not steal each other's moves.
 */

const STICK_RADIUS = 46;
/** The centre of the stick does nothing, so a resting thumb never creeps the player along. */
const DEAD_ZONE = 0.14;
/** >1 bends the response: most of the stick's travel is spent on slow, careful walking. */
const RESPONSE = 1.6;
/** How far above the stick's top edge the thumb has to slide to start running. */
const RUN_ZONE = 28;

/**
 * Walk on the stick, run above it - the way mobile shooters do it.
 *
 * Anywhere on the stick is a walk, from a creep near the middle to a full walk at the rim.
 * Running is a separate, deliberate gesture: slide the thumb up past the top of the stick
 * into the RUN tab and hold it there. Pushing the stick hard no longer means sprinting, which
 * made every nudge a dash and the evacuee hard to place.
 */
function Stick() {
  const base = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const runTab = useRef<HTMLDivElement>(null);
  const pointer = useRef<number | null>(null);
  const running = useRef(false);

  useEffect(() => {
    const el = base.current;
    if (!el) return;

    const setKnob = (dx: number, dy: number) => {
      if (knob.current) knob.current.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    const setRunning = (value: boolean) => {
      if (value === running.current) return;
      running.current = value;
      runtime.touchSprint = value;
      runTab.current?.setAttribute("data-on", value ? "true" : "false");
    };

    const move = (e: PointerEvent) => {
      if (pointer.current !== e.pointerId) return;
      const r = el.getBoundingClientRect();
      const rawX = e.clientX - (r.left + r.width / 2);
      const rawY = e.clientY - (r.top + r.height / 2);

      // above the stick, and mostly straight up rather than off to a side
      const run = rawY < -(STICK_RADIUS + RUN_ZONE) && Math.abs(rawX) < -rawY * 0.75;
      setRunning(run);
      if (run) {
        // running is always forward; a little sideways lean still steers
        setKnob(0, -STICK_RADIUS);
        runtime.touchMove.x = Math.max(-0.35, Math.min(0.35, rawX / (STICK_RADIUS * 2)));
        runtime.touchMove.y = 1;
        return;
      }

      const len = Math.hypot(rawX, rawY);
      const clamped = Math.min(len, STICK_RADIUS);
      const dx = len > 0 ? (rawX / len) * clamped : 0;
      const dy = len > 0 ? (rawY / len) * clamped : 0;
      setKnob(dx, dy);
      const reach = clamped / STICK_RADIUS;
      const strength = reach <= DEAD_ZONE ? 0 : Math.pow((reach - DEAD_ZONE) / (1 - DEAD_ZONE), RESPONSE);
      // screen-down is "back", so y is inverted into forward/back
      runtime.touchMove.x = len > 0 ? (rawX / len) * strength : 0;
      runtime.touchMove.y = len > 0 ? (-rawY / len) * strength : 0;
    };

    const end = (e: PointerEvent) => {
      if (pointer.current !== e.pointerId) return;
      pointer.current = null;
      runtime.touchMove.x = 0;
      runtime.touchMove.y = 0;
      setRunning(false);
      setKnob(0, 0);
    };

    const start = (e: PointerEvent) => {
      pointer.current = e.pointerId;
      el.setPointerCapture(e.pointerId);
      move(e);
    };

    el.addEventListener("pointerdown", start);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    return () => {
      el.removeEventListener("pointerdown", start);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
      runtime.touchMove.x = 0;
      runtime.touchMove.y = 0;
      runtime.touchSprint = false;
    };
  }, []);

  return (
    <div
      ref={base}
      aria-label="Move"
      className="pointer-events-auto relative grid h-[112px] w-[112px] touch-none place-items-center rounded-full border-2 border-white/25 bg-black/35"
    >
      <div className="absolute inset-3 rounded-full border border-white/10" />
      {/* the run tab: lights up while the thumb holds it */}
      <div
        ref={runTab}
        data-on="false"
        aria-hidden
        className="run-tab pointer-events-none absolute -top-12 left-1/2 flex -translate-x-1/2 flex-col items-center"
      >
        <span className="text-[10px] leading-none">▲</span>
        <span className="mt-0.5 border-2 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.18em]">Run</span>
      </div>
      <div ref={knob} className="h-12 w-12 rounded-full border-2 border-sun bg-sun/25" />
    </div>
  );
}

/** Everything not under a control is a look surface. */
function LookPad() {
  const pad = useRef<HTMLDivElement>(null);
  const pointer = useRef<number | null>(null);
  const last = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const el = pad.current;
    if (!el) return;

    const start = (e: PointerEvent) => {
      if (pointer.current !== null) return;
      pointer.current = e.pointerId;
      last.current = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (pointer.current !== e.pointerId) return;
      runtime.touchLook.dx += e.clientX - last.current.x;
      runtime.touchLook.dy += e.clientY - last.current.y;
      last.current = { x: e.clientX, y: e.clientY };
    };
    const end = (e: PointerEvent) => {
      if (pointer.current !== e.pointerId) return;
      pointer.current = null;
    };

    el.addEventListener("pointerdown", start);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    return () => {
      el.removeEventListener("pointerdown", start);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
    };
  }, []);

  return (
    <div
      ref={pad}
      aria-label="Look around"
      className="pointer-events-auto absolute inset-0 touch-none"
    />
  );
}

function ActionButton({
  label,
  hint,
  color,
  onPress,
  size,
  className = "",
}: {
  label: string;
  hint?: string;
  color: string;
  onPress: () => void;
  size: number;
  className?: string;
}) {
  return (
    <button
      onPointerDown={(e) => {
        e.preventDefault();
        onPress();
      }}
      className={`pointer-events-auto absolute grid touch-none place-content-center rounded-full border-2 bg-black/45 active:scale-95 ${className}`}
      style={{ borderColor: color, width: size, height: size }}
    >
      <span
        className="text-[11px] font-black uppercase tracking-[0.08em]"
        style={{ color }}
      >
        {label}
      </span>
      {hint && (
        <span className="text-[8px] font-bold uppercase tracking-wider text-white/50">
          {hint}
        </span>
      )}
    </button>
  );
}

export default function TouchControls() {
  const prompt = useSimulation((s) => s.prompt);
  // yes/no rather than the values: air and health change every hazard tick
  const down = useSimulation((s) => s.air <= 0 || s.health <= 0);
  const failed = useSimulation((s) => s.failed);
  const assemblyConfirmed = useSimulation((s) => s.assemblyConfirmed);
  const briefingStatus = useSimulation((s) => s.briefingStatus);
  const paused = useSimulation((s) => s.paused);
  const toggleCameraMode = useSimulation((s) => s.toggleCameraMode);
  // only label the interact button with what it would actually do
  const [action, setAction] = useState<string | null>(null);

  const observer = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => {
      setAction(runtime.useTarget?.kind ?? null);
    }, 200);
    return () => window.clearInterval(id);
  }, []);

  // Publish the real control height instead of hard-coding it. The old fixed offsets were
  // measured on one tall phone and pushed the prompt off the top of a 360x640 screen.
  //
  // A callback ref rather than useEffect: this component returns null until the briefing
  // finishes, so an effect with an empty dependency list runs while the dock does not exist
  // yet and would never see it appear.
  const dock = useCallback((node: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node) {
      document.documentElement.style.removeProperty("--touch-dock-h");
      return;
    }
    const publish = () =>
      document.documentElement.style.setProperty(
        "--touch-dock-h",
        `${Math.round(node.getBoundingClientRect().height)}px`,
      );
    publish();
    observer.current = new ResizeObserver(publish);
    observer.current.observe(node);
  }, []);

  useEffect(() => () => observer.current?.disconnect(), []);

  if (briefingStatus !== "complete" || paused || down || failed || assemblyConfirmed) return null;
  const assemblyHere = action === "assembly";

  return (
    // Under the HUD (z-10), not over it: the look pad fills the screen, and on top it swallowed
    // every tap meant for the menu button and the objectives card.
    <div className="pointer-events-none absolute inset-0 z-[6] select-none">
      <LookPad />

      {/* the prompt sits above the thumbs where it can be read mid-move */}
      {prompt && (
        <div className="above-dock pointer-events-none absolute inset-x-0 flex justify-center px-4">
          <div className="border-2 border-ink bg-paper px-3 py-1.5 text-center text-[12px] font-bold text-ink shadow-[3px_3px_0_var(--ink)]">
            {prompt}
          </div>
        </div>
      )}

      {/* one dock, measured, so nothing downstream has to guess how tall the controls are */}
      <div ref={dock} className="safe-bottom safe-x absolute inset-x-0 bottom-0 flex items-end justify-between">
        <Stick />

        {/* a thumb cluster, not a column: jump under the thumb, use beside it, camera above */}
        <div className="relative h-[124px] w-[132px]">
          <ActionButton
            label={assemblyHere ? "READY" : "JUMP"}
            hint={assemblyHere ? "assembly" : undefined}
            color={assemblyHere ? "#2fd18f" : "#ffc44d"}
            onPress={pressJump}
            size={64}
            className="bottom-0 right-0"
          />
          <ActionButton
            label="E"
            hint="use"
            color={action === "intervention" ? "#7b5cff" : action === "scenario" ? "#ffc44d" : "#9a8fa3"}
            onPress={pressUse}
            size={58}
            className="bottom-3 right-[70px]"
          />
          <ActionButton
            label="CAM"
            color="#c9b8ff"
            onPress={toggleCameraMode}
            size={42}
            className="bottom-[72px] right-2"
          />
        </div>
      </div>
    </div>
  );
}
