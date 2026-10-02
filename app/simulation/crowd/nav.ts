import type { P2 } from "./world";

/**
 * Where a person can stand, and how to get from one spot to another.
 *
 * The map is not authored: it is read off the building's own physics colliders once, by
 * probing a person-sized box at every cell. Walls, furniture, stacks and counters all block
 * it for free, so an agent's path goes round the lab benches the way a person would.
 */

export const CELL = 0.4;
const MIN_X = -31;
const MAX_X = 31;
const MIN_Z = -31;
const MAX_Z = 29;
export const COLS = Math.round((MAX_X - MIN_X) / CELL);
export const ROWS = Math.round((MAX_Z - MIN_Z) / CELL);

export interface NavGrid {
  blocked: Uint8Array;
}

const index = (c: number, r: number) => r * COLS + c;
export const cellOf = (x: number, z: number): [number, number] => [
  Math.max(0, Math.min(COLS - 1, Math.floor((x - MIN_X) / CELL))),
  Math.max(0, Math.min(ROWS - 1, Math.floor((z - MIN_Z) / CELL))),
];
export const centerOf = (c: number, r: number): P2 => [MIN_X + (c + 0.5) * CELL, MIN_Z + (r + 0.5) * CELL];

/** `probe(x, z)` answers whether a person-sized box centred there touches anything solid. */
export function buildGrid(probe: (x: number, z: number) => boolean): NavGrid {
  const blocked = new Uint8Array(COLS * ROWS);
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const [x, z] = centerOf(c, r);
      blocked[index(c, r)] = probe(x, z) ? 1 : 0;
    }
  return { blocked };
}

export const walkable = (grid: NavGrid, c: number, r: number) =>
  c >= 0 && r >= 0 && c < COLS && r < ROWS && grid.blocked[index(c, r)] === 0;

/** The nearest standing spot to a point, searching outward ring by ring. */
export function nearestFree(grid: NavGrid, x: number, z: number): [number, number] | null {
  const [c0, r0] = cellOf(x, z);
  if (walkable(grid, c0, r0)) return [c0, r0];
  for (let ring = 1; ring < 12; ring++)
    for (let dc = -ring; dc <= ring; dc++)
      for (let dr = -ring; dr <= ring; dr++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== ring) continue;
        if (walkable(grid, c0 + dc, r0 + dr)) return [c0 + dc, r0 + dr];
      }
  return null;
}

/** Straight walk between two cells without touching a blocked one. */
function clearLine(grid: NavGrid, a: [number, number], b: [number, number]) {
  const steps = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) * 2;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const c = Math.round(a[0] + (b[0] - a[0]) * t);
    const r = Math.round(a[1] + (b[1] - a[1]) * t);
    if (!walkable(grid, c, r)) return false;
  }
  return true;
}

/** A small binary heap of cell indices keyed by f-score. */
class Heap {
  private items: number[] = [];
  constructor(private score: Float32Array) {}
  get size() {
    return this.items.length;
  }
  push(i: number) {
    const a = this.items;
    a.push(i);
    let n = a.length - 1;
    while (n > 0) {
      const p = (n - 1) >> 1;
      if (this.score[a[p]] <= this.score[a[n]]) break;
      [a[p], a[n]] = [a[n], a[p]];
      n = p;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let n = 0;
      for (;;) {
        const l = n * 2 + 1;
        const r = l + 1;
        let m = n;
        if (l < a.length && this.score[a[l]] < this.score[a[m]]) m = l;
        if (r < a.length && this.score[a[r]] < this.score[a[m]]) m = r;
        if (m === n) break;
        [a[m], a[n]] = [a[n], a[m]];
        n = m;
      }
    }
    return top;
  }
}

const g = new Float32Array(COLS * ROWS);
const f = new Float32Array(COLS * ROWS);
const from = new Int32Array(COLS * ROWS);
const seen = new Uint32Array(COLS * ROWS);
let stamp = 0;

/** Shortest walk from one point to another, smoothed to as few straight legs as possible. */
export function findPath(grid: NavGrid, start: P2, goal: P2): P2[] | null {
  const s = nearestFree(grid, start[0], start[1]);
  const e = nearestFree(grid, goal[0], goal[1]);
  if (!s || !e) return null;
  stamp++;
  const si = index(s[0], s[1]);
  const ei = index(e[0], e[1]);
  const h = (c: number, r: number) => {
    const dx = Math.abs(c - e[0]);
    const dr = Math.abs(r - e[1]);
    return Math.max(dx, dr) + 0.414 * Math.min(dx, dr);
  };
  g[si] = 0;
  f[si] = h(s[0], s[1]);
  from[si] = -1;
  seen[si] = stamp;
  const open = new Heap(f);
  open.push(si);
  const closed = new Set<number>();
  let found = false;
  while (open.size) {
    const cur = open.pop();
    if (cur === ei) {
      found = true;
      break;
    }
    if (closed.has(cur)) continue;
    closed.add(cur);
    const c = cur % COLS;
    const r = (cur - c) / COLS;
    for (let dc = -1; dc <= 1; dc++)
      for (let dr = -1; dr <= 1; dr++) {
        if (!dc && !dr) continue;
        const nc = c + dc;
        const nr = r + dr;
        if (!walkable(grid, nc, nr)) continue;
        // no corner cutting past a blocked cell
        if (dc && dr && (!walkable(grid, c + dc, r) || !walkable(grid, c, r + dr))) continue;
        const ni = index(nc, nr);
        const cost = g[cur] + (dc && dr ? 1.414 : 1);
        if (seen[ni] === stamp && cost >= g[ni]) continue;
        seen[ni] = stamp;
        g[ni] = cost;
        f[ni] = cost + h(nc, nr);
        from[ni] = cur;
        open.push(ni);
      }
  }
  if (!found) return null;

  const cells: [number, number][] = [];
  for (let i = ei; i !== -1; i = from[i]) cells.push([i % COLS, Math.floor(i / COLS)]);
  cells.reverse();
  // string-pull: keep only the corners a straight walk cannot skip
  const legs: [number, number][] = [cells[0]];
  let anchor = cells[0];
  for (let i = 2; i < cells.length; i++) {
    if (!clearLine(grid, anchor, cells[i])) {
      anchor = cells[i - 1];
      legs.push(anchor);
    }
  }
  legs.push(cells[cells.length - 1]);
  const points = legs.map(([c, r]) => centerOf(c, r));
  // finish exactly on the goal when it is standable, not on the centre of its cell
  const [gc, gr] = cellOf(goal[0], goal[1]);
  if (walkable(grid, gc, gr)) points[points.length - 1] = [goal[0], goal[1]];
  return points;
}
