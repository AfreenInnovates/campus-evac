import { findPath, walkable, cellOf, type NavGrid } from "./nav";
import { exitDistance, nextHop, parseTarget, type Target } from "./orders";
import { farPoint, FIRE_BURN, FIRE_REACH, fireSpot, isSafe, LINKS, linksOf, otherSide, roomAt, roomById, smokeAt, smokeDose, type Link, type P2, type RoomId } from "./world";

/**
 * The rest of the school: everyone who is not one of the AI people.
 *
 * A designed floor holds hundreds of people; giving each a language model would cost a
 * fortune and teach nothing more. So a few people per room are AI, and the rest follow simple,
 * well-documented crowd behaviour: they hesitate after the alarm, follow announcements, follow
 * whoever in their room is leaving, read exit signs while the smoke allows, crawl under thick
 * smoke. No model calls; a few hundred of them cost a fraction of a millisecond a frame.
 */

export type CrowdStatus = "inside" | "safe" | "down";

export interface Follower {
  id: number;
  x: number;
  z: number;
  heading: number;
  room: RoomId;
  status: CrowdStatus;
  health: number;
  crawl: boolean;
  path: P2[] | null;
  leg: number;
  via: Link | null;
  /** when they stop hesitating and start to move */
  startAt: number;
  /** where an announcement told everyone to go */
  target: Target | null;
  heardAt: number;
  firstMoveAt: number | null;
  movedAt: number;
  endedAt: number | null;
  exit: string | null;
  nearestExit: string | null;
  blindFor: number;
  /** cut off by the fire: door shut, low by a window, waiting for firefighters */
  sheltering: boolean;
  /** how many times in a row they found no way out at all */
  stuck: number;
}

/** What the crowd needs to know about the moment: the AI people (whom they follow), the fire, the smoke. */
export interface CrowdWorld {
  t: number;
  dt: number;
  grid: NavGrid | null;
  leaders: { room: RoomId; via: Link | null; path: unknown; status: string; x: number; z: number }[];
  origin: RoomId;
  hops: Record<string, number>;
  hidesSigns: (smoke: number) => boolean;
}

const WALK = 1.3;
const CRAWL = 0.6;

/** Place a room's worth of followers on free floor, clear of each other. */
export function spawnCrowd(counts: Map<RoomId, number>, random: () => number, grid: NavGrid | null, nearest: Map<RoomId, string | null>, firstId: number): Follower[] {
  const crowd: Follower[] = [];
  let id = firstId;
  for (const [room, count] of counts) {
    const b = roomById(room).bounds;
    for (let i = 0; i < count; i++) {
      let x = (b.minX + b.maxX) / 2;
      let z = (b.minZ + b.maxZ) / 2;
      for (let attempt = 0; attempt < 30; attempt++) {
        const px = b.minX + 0.6 + random() * (b.maxX - b.minX - 1.2);
        const pz = b.minZ + 0.6 + random() * (b.maxZ - b.minZ - 1.2);
        if (grid && !walkable(grid, ...cellOf(grid, px, pz))) continue;
        x = px;
        z = pz;
        break;
      }
      crowd.push({
        id: id++,
        x,
        z,
        heading: random() * Math.PI * 2,
        room,
        status: "inside",
        health: 100,
        crawl: false,
        path: null,
        leg: 0,
        via: null,
        // most people wait a few seconds to see what others do; some wait much longer
        startAt: 3 + random() * random() * 25,
        target: null,
        heardAt: 0,
        firstMoveAt: null,
        movedAt: 0,
        endedAt: null,
        exit: null,
        nearestExit: nearest.get(room) ?? null,
        blindFor: 0,
        sheltering: false,
        stuck: 0,
      });
    }
  }
  return crowd;
}

/** An announcement to everyone: whoever is still inside takes in where it sends them, a moment later. */
export function hearBroadcast(crowd: Follower[], text: string, t: number) {
  const target = parseTarget(text);
  for (const f of crowd) {
    if (f.status !== "inside") continue;
    f.heardAt = t + 1 + Math.random() * 3;
    if (target && target.kind !== "shelter") f.target = target;
    // an announcement is often what finally gets people moving
    f.startAt = Math.min(f.startAt, f.heardAt);
  }
}

/** Doorways a follower found no route to, per drill's map and rough spot, so nobody searches twice for a way the fire has cut. */
const noRoute = new WeakMap<NavGrid, Set<string>>();

function go(f: Follower, link: Link, grid: NavGrid | null) {
  const to = farPoint(link, f.room);
  const key = `${link.id}|${Math.round(f.x / 3)}|${Math.round(f.z / 3)}`;
  const dead = grid ? (noRoute.get(grid) ?? noRoute.set(grid, new Set()).get(grid)!) : null;
  if (dead?.has(key)) return false;
  const path = grid ? findPath(grid, [f.x, f.z], to) : [to];
  if (!path) {
    dead?.add(key);
    return false;
  }
  f.path = path;
  f.leg = 0;
  f.via = link;
  return true;
}

/**
 * Which doorways to try, best first, by the rules people actually follow: an instruction they
 * heard, then the people around them, then the signs, and in smoke too thick to read, the least
 * smoky way. The caller takes the first one there is a route to, so a way blocked by the fire
 * simply falls to the next.
 */
function choices(f: Follower, w: CrowdWorld): Link[] {
  const options = linksOf(f.room);
  const ranked: Link[] = [];
  if (f.target && w.t >= f.heardAt) {
    const hop = nextHop(f.room, f.target, w.origin);
    if (hop) ranked.push(hop);
  }
  // people follow others leaving their room, but not back into the fire or deeper into a dead end
  const here = exitDistance(f.room, w.origin);
  const leaving = w.leaders.filter((l) => {
    if (l.status !== "inside" || l.room !== f.room || !l.path || !l.via || !options.includes(l.via)) return false;
    const next = otherSide(l.via, f.room);
    return next === "outside" || (next !== w.origin && exitDistance(next, w.origin) < here);
  });
  if (leaving.length) ranked.push(leaving[Math.floor(Math.random() * leaving.length)].via!);
  const smoke = smokeAt(f.room, w.t, w.hops);
  if (!w.hidesSigns(smoke)) {
    // ways out right here, nearest first
    ranked.push(...options.filter((link) => link.exit).sort((a, b) => Math.hypot(a.door[0] - f.x, a.door[1] - f.z) - Math.hypot(b.door[0] - f.x, b.door[1] - f.z)));
    const signs = nextHop(f.room, { kind: "out", label: "Nearest exit" }, w.origin);
    if (signs) ranked.push(signs);
  }
  ranked.push(...[...options].sort((a, b) => smokeAt(otherSide(a, f.room), w.t, w.hops) - smokeAt(otherSide(b, f.room), w.t, w.hops)));
  return [...new Set(ranked)];
}

/** Advance the crowd one frame. Returns how many are still trying to get out. */
export function stepCrowd(crowd: Follower[], w: CrowdWorld, onOut: (f: Follower) => void, onDown: (f: Follower) => void) {
  const { t, dt } = w;
  const [fx, fz] = fireSpot(w.origin);
  let moving = 0;
  for (const f of crowd) {
    if (f.status !== "inside") continue;
    const smoke = smokeAt(f.room, t, w.hops);
    if (f.sheltering) {
      // waiting it out behind a shut door: far less smoke gets in
      f.health = Math.max(0, f.health - smokeDose(smoke, true, true) * dt);
      if (f.health <= 0) {
        f.status = "down";
        f.endedAt = t;
        onDown(f);
      }
      continue;
    }
    moving++;
    f.crawl = smoke > 0.45;
    // nobody hesitates once they can see flames or smell smoke
    if (t < f.startAt && ((f.room === w.origin && t > 1) || smoke > 0.08)) f.startAt = Math.min(f.startAt, t + 0.4 + (f.id % 5) * 0.25);
    if (w.hidesSigns(smoke)) f.blindFor += dt;

    if (t >= f.startAt) {
      if (!f.path || f.leg >= f.path.length) {
        f.path = null;
        if (f.room === "outside") {
          const exits = LINKS.filter((link) => link.exit);
          const exit = f.via?.exit ? f.via : exits.sort((a, b) => Math.hypot(a.door[0] - f.x, a.door[1] - f.z) - Math.hypot(b.door[0] - f.x, b.door[1] - f.z))[0];
          const out = exit && (exit.a === "outside" ? exit.pa : exit.pb);
          if (out) f.path = (w.grid && findPath(w.grid, [f.x, f.z], out)) || [out];
          f.leg = 0;
        } else {
          // the first choice there is a route to; with no way through at all, look again in a moment
          if (choices(f, w).some((link) => go(f, link, w.grid))) f.stuck = 0;
          else if (++f.stuck >= 3) {
            // three tries, no way out past the fire: do what the training says, shelter in place
            f.sheltering = true;
            f.path = null;
            moving--;
            continue;
          } else f.startAt = t + 2;
        }
      }
      if (f.path && f.leg < f.path.length) {
        const [tx, tz] = f.path[f.leg];
        const dx = tx - f.x;
        const dz = tz - f.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.15) f.leg++;
        else {
          const step = Math.min(dist, (f.crawl ? CRAWL : WALK) * (f.health < 30 ? 0.6 : 1) * dt);
          f.x += (dx / dist) * step;
          f.z += (dz / dist) * step;
          f.heading = Math.atan2(dx, dz);
          f.movedAt = t;
          f.firstMoveAt ??= t;
        }
      }
    }

    f.room = roomAt(f.x, f.z);
    if (isSafe(f.x, f.z)) {
      f.status = "safe";
      f.endedAt = t;
      f.exit = f.via?.exit ?? null;
      moving--;
      onOut(f);
      continue;
    }
    const nearFire = f.room === w.origin && Math.hypot(f.x - fx, f.z - fz) < FIRE_REACH && t > 2;
    f.health = Math.max(0, f.health - (smokeDose(smoke, f.crawl, false) + (nearFire ? FIRE_BURN : 0)) * dt);
    if (f.health <= 0) {
      f.status = "down";
      f.endedAt = t;
      moving--;
      onDown(f);
    }
  }
  return moving;
}

/** People do not stand inside each other: a gentle push apart, for followers among themselves and around the AI people. */
export function separate(crowd: Follower[], others: { x: number; z: number; status: string }[]) {
  const all = [...crowd.filter((f) => f.status === "inside"), ...others.filter((o) => o.status === "inside")];
  // a coarse spatial hash keeps this linear in the crowd size
  const cells = new Map<number, typeof all>();
  const key = (x: number, z: number) => Math.floor(x) * 4096 + Math.floor(z);
  for (const p of all) {
    const k = key(p.x, p.z);
    const list = cells.get(k);
    if (list) list.push(p);
    else cells.set(k, [p]);
  }
  for (const f of crowd) {
    if (f.status !== "inside") continue;
    const cx = Math.floor(f.x);
    const cz = Math.floor(f.z);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        for (const o of cells.get((cx + dx) * 4096 + (cz + dz)) ?? []) {
          if (o === f) continue;
          const ox = f.x - o.x;
          const oz = f.z - o.z;
          const d = Math.hypot(ox, oz);
          if (d > 0.001 && d < 0.5) {
            const push = (0.5 - d) * 0.5;
            f.x += (ox / d) * push;
            f.z += (oz / d) * push;
          }
        }
      }
  }
}

/* ------------------------------------------------------------------ recording */

export const CROWD_STATUS: CrowdStatus[] = ["inside", "safe", "down"];

/** One frame of the crowd: x, z and status per person, compact. */
/** One frame of the crowd: x, z and status per person (3: sheltering), compact. */
export const crowdFrame = (crowd: Follower[], t: number) => [
  Math.round(t * 100) / 100,
  ...crowd.flatMap((f) => [Math.round(f.x * 10) / 10, Math.round(f.z * 10) / 10, f.sheltering && f.status === "inside" ? 3 : CROWD_STATUS.indexOf(f.status)]),
];

/** Put the crowd where a recording says it was at time `t`. */
export function applyCrowdFrame(crowd: Follower[], frames: number[][], t: number) {
  let i = 0;
  while (i < frames.length - 1 && frames[i + 1][0] <= t) i++;
  const a = frames[i];
  const b = frames[Math.min(i + 1, frames.length - 1)];
  const span = b[0] - a[0];
  const k = span > 0 ? Math.min(1, Math.max(0, (t - a[0]) / span)) : 0;
  crowd.forEach((f, n) => {
    const o = 1 + n * 3;
    const nx = a[o] + (b[o] - a[o]) * k;
    const nz = a[o + 1] + (b[o + 1] - a[o + 1]) * k;
    if (Math.hypot(nx - f.x, nz - f.z) > 0.01) f.heading = Math.atan2(nx - f.x, nz - f.z);
    f.x = nx;
    f.z = nz;
    f.status = CROWD_STATUS[a[o + 2]] ?? "inside";
    f.sheltering = a[o + 2] === 3;
    f.room = roomAt(f.x, f.z);
  });
}

export function counts(crowd: Follower[]) {
  let safe = 0;
  let down = 0;
  let sheltering = 0;
  for (const f of crowd) {
    if (f.status === "safe") safe++;
    else if (f.status === "down") down++;
    else if (f.sheltering) sheltering++;
  }
  return { total: crowd.length, safe, down, sheltering, inside: crowd.length - safe - down - sheltering };
}
