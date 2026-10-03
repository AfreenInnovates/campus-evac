"use client";

import { CuboidCollider, RigidBody } from "@react-three/rapier";
import * as THREE from "three";
import { WALL_T } from "../level";
import { wallBoxes } from "../components/Building";
import type { Plan, PlanRoom } from "./world";

/**
 * A designed floor in 3D: floors, walls with their doorways, and enough furniture per room
 * that it reads as a school and people have to walk round it. Every solid piece has a
 * collider, so the navigation map is read off it like the demo campus.
 *
 * Kept deliberately plain: shared geometry and materials, boxes rather than models, so a
 * twelve-classroom floor stays light on a phone.
 */

const box = new THREE.BoxGeometry(1, 1, 1);
const mat = (color: string, roughness = 0.85) => new THREE.MeshStandardMaterial({ color, roughness });
const M = {
  ground: mat("#3f3448", 1),
  wallIn: mat("#e7dde4", 0.92),
  wallOut: mat("#c9bac8", 0.92),
  desk: mat("#b98552", 0.6),
  chair: mat("#3b4a63", 0.7),
  shelf: mat("#6d4a33", 0.7),
  bench: mat("#d7dbe0", 0.4),
  table: mat("#8f6a4a", 0.6),
  exit: new THREE.MeshBasicMaterial({ color: "#39ff88", transparent: true, opacity: 0.35, toneMapped: false }),
};
const FLOOR: Record<NonNullable<PlanRoom["kind"]>, THREE.MeshStandardMaterial> = {
  corridor: mat("#7b7770", 0.4),
  classroom: mat("#8a7f73", 0.5),
  lab: mat("#78746d", 0.4),
  library: mat("#5a4b44", 0.6),
  cafeteria: mat("#565a5c", 0.4),
  hall: mat("#6b5a4a", 0.5),
  office: mat("#6e6a63", 0.5),
  entrance: mat("#6e6a63", 0.4),
};

type V3 = [number, number, number];

/** One solid box: drawn and collided. */
function Block({ at, size, material }: { at: V3; size: V3; material: THREE.Material }) {
  return (
    <>
      <mesh geometry={box} material={material} position={at} scale={size} castShadow receiveShadow />
      <CuboidCollider position={at} args={[size[0] / 2, size[1] / 2, size[2] / 2]} />
    </>
  );
}

/**
 * Rows of furniture across the back two thirds of a room, leaving the doorway side clear and an
 * aisle down the middle and both sides, as a real room would.
 */
function Furniture({ room }: { room: PlanRoom }) {
  const b = room.bounds;
  const north = b.maxZ <= 0; // rooms north of the corridor have their door on the south wall
  const fromDoor = (d: number) => (north ? b.maxZ - d : b.minZ + d);
  const width = b.maxX - b.minX;
  const cx = (b.minX + b.maxX) / 2;
  const halves = (w: number) => [cx - (w / 4 + 0.6), cx + (w / 4 + 0.6)];
  const rowWidth = Math.max(1, (width - 1.8 - 1.2) / 2);
  const blocks: { at: V3; size: V3; material: THREE.Material }[] = [];

  switch (room.kind) {
    case "classroom":
    case "lab":
      for (const d of room.kind === "lab" ? [2.6, 4.6, 6.6] : [2.4, 3.9, 5.4, 6.9]) {
        for (const x of halves(width - 1.8)) {
          blocks.push({ at: [x, 0.375, fromDoor(d)], size: [rowWidth, 0.75, room.kind === "lab" ? 0.9 : 0.55], material: room.kind === "lab" ? M.bench : M.desk });
        }
      }
      break;
    case "library":
      for (const d of [2.8, 4.6, 6.4]) for (const x of halves(width - 1.8)) blocks.push({ at: [x, 1, fromDoor(d)], size: [rowWidth, 2, 0.5], material: M.shelf });
      break;
    case "cafeteria":
      for (const d of [2.8, 4.8, 6.6]) for (const x of halves(width - 1.8)) blocks.push({ at: [x, 0.38, fromDoor(d)], size: [rowWidth, 0.76, 1], material: M.table });
      break;
    case "office":
      blocks.push({ at: [cx, 0.38, fromDoor(4.6)], size: [Math.min(3, width - 2), 0.76, 1.4], material: M.table });
      break;
    case "entrance":
      blocks.push({ at: [b.minX + 1.4, 0.55, fromDoor(4)], size: [1.2, 1.1, 2.2], material: M.desk });
      break;
    case "hall":
      blocks.push({ at: [cx, 0.3, fromDoor(7)], size: [Math.min(8, width - 2), 0.6, 1.6], material: M.table });
      break;
  }
  return (
    <>
      {blocks.map((block, i) => (
        <Block key={i} {...block} />
      ))}
    </>
  );
}

export default function DesignedBuilding({ plan }: { plan: Plan }) {
  const b = plan.bounds;
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  return (
    <RigidBody type="fixed" colliders={false}>
      {/* the ground, and an invisible fence well outside so nobody wanders off */}
      <mesh geometry={box} material={M.ground} position={[cx, -0.14, cz]} scale={[b.maxX - b.minX + 80, 0.24, b.maxZ - b.minZ + 80]} receiveShadow />
      <CuboidCollider position={[cx, -0.25, cz]} args={[(b.maxX - b.minX) / 2 + 40, 0.25, (b.maxZ - b.minZ) / 2 + 40]} />
      {(
        [
          [cx, b.minZ - 9, (b.maxX - b.minX) / 2 + 10, 0.5],
          [cx, b.maxZ + 19, (b.maxX - b.minX) / 2 + 10, 0.5],
          [b.minX - 10, cz, 0.5, (b.maxZ - b.minZ) / 2 + 20],
          [b.maxX + 10, cz, 0.5, (b.maxZ - b.minZ) / 2 + 20],
        ] as const
      ).map(([x, z, hx, hz], i) => (
        <CuboidCollider key={i} position={[x, 3, z]} args={[hx, 4, hz]} />
      ))}

      {plan.rooms.map((room) => {
        const r = room.bounds;
        return (
          <mesh
            key={room.id}
            geometry={box}
            material={FLOOR[room.kind ?? "classroom"]}
            position={[(r.minX + r.maxX) / 2, -WALL_T / 2 + 0.01, (r.minZ + r.maxZ) / 2]}
            scale={[r.maxX - r.minX, WALL_T, r.maxZ - r.minZ]}
            receiveShadow
          />
        );
      })}

      {(plan.walls ?? []).flatMap((def) =>
        wallBoxes(def).map((w, i) => <Block key={`${def.id}-${i}`} at={w.pos} size={w.size} material={def.id.startsWith("outer") ? M.wallOut : M.wallIn} />),
      )}

      {plan.rooms.map((room) => (
        <Furniture key={room.id} room={room} />
      ))}

      {/* the ways out glow green on the ground */}
      {plan.links
        .filter((link) => link.exit)
        .map((link) => (
          <mesh key={link.id} position={[link.door[0], 0.02, link.door[1]]} rotation={[-Math.PI / 2, 0, 0]} material={M.exit}>
            <planeGeometry args={[2.2, 2.2]} />
          </mesh>
        ))}
    </RigidBody>
  );
}
