import { MASSES, WALL_T, WALLS, type WallDef } from "../level";
import { buildGrid, type NavGrid } from "./nav";
import type { Plan } from "./world";

/**
 * The walking map for a building with no 3D scene, read off its wall plan instead of its
 * physics colliders: for drills run on the server. Walls and solid masses block, doorways are
 * the gaps between them. Furniture is not in the plan, so people here walk across open rooms;
 * the rooms and doorways they pass through are the same as in the browser.
 */

interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** A person's footprint, the same box the browser probes the colliders with. */
const HALF = 0.24;

/** A wall run cut into solid boxes around its openings. */
function wallBoxes(def: WallDef): Box[] {
  const boxes: Box[] = [];
  const half = WALL_T / 2;
  const push = (from: number, to: number) => {
    if (to - from < 0.01) return;
    boxes.push(
      def.axis === "x"
        ? { minX: from, maxX: to, minZ: def.fixed - half, maxZ: def.fixed + half }
        : { minX: def.fixed - half, maxX: def.fixed + half, minZ: from, maxZ: to },
    );
  };
  let cursor = def.from;
  for (const opening of [...(def.openings ?? [])].sort((a, b) => a.at - b.at)) {
    push(cursor, opening.at - opening.width / 2);
    cursor = opening.at + opening.width / 2;
  }
  push(cursor, def.to);
  return boxes;
}

export function solidsOf(plan: Plan): Box[] {
  const walls = plan.demo ? WALLS : (plan.walls ?? []);
  const masses = plan.demo ? MASSES.map((m) => ({ minX: m.x1, maxX: m.x2, minZ: m.z1, maxZ: m.z2 })) : [];
  return [...walls.flatMap(wallBoxes), ...masses];
}

export function gridFromWalls(plan: Plan): NavGrid {
  const solids = solidsOf(plan);
  const probe = (x: number, z: number) =>
    solids.some((b) => x + HALF > b.minX && x - HALF < b.maxX && z + HALF > b.minZ && z - HALF < b.maxZ);
  const b = plan.bounds;
  // the same margin outside the building as the browser's map, so people can walk clear of the doors
  return buildGrid(probe, { minX: b.minX - 9, maxX: b.maxX + 9, minZ: b.minZ - 8, maxZ: b.maxZ + 18 });
}
