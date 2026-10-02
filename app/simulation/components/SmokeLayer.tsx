"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ROOMS, roomHeight, type RoomDef } from "../level";
import { getSectorSmoke, SMOKE_PROFILES, VENTILATION_SMOKE_FACTOR } from "../smoke";
import { runtime } from "../runtime";
import { useSimulation } from "../store";

/** A tiling cloud texture, drawn once: soft overlapping puffs, wrapped at the edges. */
let cloud: THREE.CanvasTexture | null = null;
function cloudTexture() {
  if (cloud) return cloud;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  let seed = 11;
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (let i = 0; i < 70; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 18 + rnd() * 46;
    const a = 0.05 + rnd() * 0.12;
    // draw each puff at every wrapped offset so the texture tiles without seams
    for (const dx of [-size, 0, size])
      for (const dy of [-size, 0, size]) {
        const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        g.addColorStop(0, `rgba(255,255,255,${a})`);
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
      }
  }
  cloud = new THREE.CanvasTexture(canvas);
  cloud.wrapS = cloud.wrapT = THREE.RepeatWrapping;
  cloud.colorSpace = THREE.SRGBColorSpace;
  return cloud;
}

/** Only rooms within this many metres of the evacuee draw their smoke; walls hide the rest. */
const NEAR = 4;

/**
 * Hot smoke collects under the ceiling first and banks down as the room fills - the reason
 * the drill says "stay low". Each room carries a few drifting sheets whose opacity and
 * height follow the same authored smoke curve that drains the evacuee's air.
 */
function RoomSmoke({ room, layers }: { room: RoomDef; layers: number }) {
  const b = room.bounds;
  const w = b.maxX - b.minX - 0.4;
  const d = b.maxZ - b.minZ - 0.4;
  const h = roomHeight(room.id);
  const group = useRef<THREE.Group>(null);
  const level = useRef(0);
  const materials = useMemo(
    () =>
      Array.from({ length: layers }, (_, i) => {
        const map = cloudTexture().clone();
        map.repeat.set(w / (5 + i), d / (5 + i));
        map.needsUpdate = true;
        return new THREE.MeshBasicMaterial({
          map,
          color: i % 2 ? "#8d837f" : "#a39a94",
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
          fog: true,
        });
      }),
    [w, d, layers],
  );

  useFrame(({ clock }, dt) => {
    const sim = useSimulation.getState();
    const target =
      getSectorSmoke(room.id, runtime.hazardElapsed) * (sim.interventionApplied ? VENTILATION_SMOKE_FACTOR : 1);
    level.current += (target - level.current) * Math.min(1, dt * 1.5);
    const smoke = level.current;
    // how far the evacuee is from this room's floor plan (0 inside it)
    const p = runtime.evacuee;
    const away = Math.hypot(
      Math.max(b.minX - p.x, 0, p.x - b.maxX),
      Math.max(b.minZ - p.z, 0, p.z - b.maxZ),
    );
    const show = smoke > 0.01 && away < NEAR;
    if (group.current) group.current.visible = show;
    if (!show) return;
    const t = clock.elapsedTime;
    // the underside of the layer creeps down from the ceiling as the room fills
    const depth = 0.4 + smoke * Math.min(2.2, h * 0.45);
    materials.forEach((material, i) => {
      material.opacity = Math.min(0.85, smoke * (0.5 + i * 0.12) * (4 / (layers + 1)));
      material.map!.offset.set(t * (0.004 + i * 0.002) * (i % 2 ? -1 : 1), t * 0.003 * (i + 1));
      const mesh = group.current?.children[i];
      if (mesh) mesh.position.y = h - 0.15 - (depth * (i + 1)) / layers;
    });
  });

  return (
    <group ref={group} position={[(b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2]} visible={false}>
      {materials.map((material, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} material={material} renderOrder={6 + i}>
          <planeGeometry args={[w, d]} />
        </mesh>
      ))}
    </group>
  );
}

export default function SmokeLayer({ touch }: { touch: boolean }) {
  const evacueeView = useSimulation((s) => s.view === "evacuee");
  const layers = touch ? 2 : 3;
  if (!evacueeView) return null;
  return (
    <>
      {ROOMS.filter((room) => room.id !== "outside" && SMOKE_PROFILES[room.id].peakIntensity > 0).map((room) => (
        <RoomSmoke key={room.id} room={room} layers={layers} />
      ))}
    </>
  );
}
