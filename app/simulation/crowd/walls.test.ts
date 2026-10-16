import { test } from "node:test";
import assert from "node:assert/strict";
import { findPath } from "./nav.ts";
import { gridFromWalls } from "./walls.ts";
import { DEMO_PLAN, INDOOR, LINKS, roomCenter } from "./world.ts";

test("from every room of the demo campus there is a walkable path to every exit", () => {
  const grid = gridFromWalls(DEMO_PLAN);
  for (const room of INDOOR)
    for (const link of LINKS.filter((l) => l.exit)) assert.ok(findPath(grid, roomCenter(room), link.pb), `${room} -> ${link.exit}`);
});

test("walls block: a path never goes straight through the wall between two rooms", () => {
  const grid = gridFromWalls(DEMO_PLAN);
  // Library to Chemistry Lab share a wall; the walk must be longer than the straight line
  const [a, b] = [roomCenter("library"), roomCenter("sec")];
  const path = findPath(grid, a, b)!;
  let length = 0;
  let prev = a;
  for (const p of path) {
    length += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    prev = p;
  }
  assert.ok(length > Math.hypot(b[0] - a[0], b[1] - a[1]) * 1.3);
});
