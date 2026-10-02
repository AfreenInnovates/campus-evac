"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { roomAt } from "../level";
import { ROOM_LIGHTS } from "../lights";
import { clampDt, runtime } from "../runtime";

/** Lamps in another room are pushed back this far, so the room you are in wins ties. */
const OTHER_ROOM_PENALTY = 9;
const RESELECT_SECONDS = 0.25;

interface Slot {
  /** The lamp this light currently stands in for, or -1. */
  current: number;
  /** The lamp it has been asked to move to; it fades out, jumps, and fades back in. */
  next: number;
}

/**
 * A fixed handful of point lights that follow the evacuee from room to room.
 *
 * The count never changes, so three.js never recompiles a shader when the player walks
 * through a door - only positions, colours and intensities move. A slot being reassigned
 * dims to nothing before it jumps, so a lamp never visibly pops.
 */
export default function LightPool({ size }: { size: number }) {
  const lights = useRef<(THREE.PointLight | null)[]>([]);
  const pool = useRef<Slot[]>([]);
  const timer = useRef(RESELECT_SECONDS);

  useFrame((_, rawDt) => {
    const dt = clampDt(rawDt);
    if (pool.current.length !== size) {
      pool.current = Array.from({ length: size }, () => ({ current: -1, next: -1 }));
      timer.current = RESELECT_SECONDS;
    }
    const slots = pool.current;
    timer.current += dt;
    if (timer.current >= RESELECT_SECONDS) {
      timer.current = 0;
      const here = runtime.evacuee;
      const room = roomAt(here.x, here.z);
      const wanted = ROOM_LIGHTS.map((lamp, index) => ({
        index,
        score:
          Math.hypot(lamp.position[0] - here.x, lamp.position[2] - here.z) +
          (lamp.room === room ? 0 : OTHER_ROOM_PENALTY),
      }))
        .sort((a, b) => a.score - b.score)
        .slice(0, size)
        .map((entry) => entry.index);
      // keep slots already on a wanted lamp; hand the rest out to free slots
      const taken = new Set(slots.map((slot) => slot.next).filter((index) => wanted.includes(index)));
      const missing = wanted.filter((index) => !taken.has(index));
      for (const slot of slots) {
        if (wanted.includes(slot.next)) continue;
        slot.next = missing.shift() ?? -1;
      }
    }

    const k = Math.min(1, dt * 6);
    slots.forEach((slot, i) => {
      const light = lights.current[i];
      if (!light) return;
      if (slot.current !== slot.next) {
        light.intensity += (0 - light.intensity) * Math.min(1, dt * 14);
        if (light.intensity > 0.05) return;
        slot.current = slot.next;
        const lamp = ROOM_LIGHTS[slot.current];
        if (!lamp) return;
        light.position.set(...lamp.position);
        light.distance = lamp.distance;
        light.decay = lamp.decay;
        light.color.set(lamp.color);
      }
      const target = ROOM_LIGHTS[slot.current]?.intensity ?? 0;
      light.intensity += (target - light.intensity) * k;
    });
  });

  return (
    <>
      {Array.from({ length: size }, (_, i) => (
        <pointLight
          key={i}
          ref={(light) => {
            lights.current[i] = light;
          }}
          intensity={0}
        />
      ))}
    </>
  );
}
