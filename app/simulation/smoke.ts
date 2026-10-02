import type { RoomId } from "./level";

export interface SmokeProfile {
  /** seconds after the drill starts before smoke reaches this sector */
  startSeconds: number;
  /** seconds over which the sector approaches its authored peak */
  riseSeconds: number;
  peakIntensity: number;
}

export const SMOKE_EXPOSURE_THRESHOLD = 0.2;
export const ROUTE_BLOCK_AFTER_SECONDS = 52;

/** Ventilation is intentionally a simple, bounded intervention for the MVP. */
export const VENTILATION_SMOKE_FACTOR = 0.2;

export const AIR_DRAIN_PER_SECOND = 2.4;

/**
 * The field follows the authored topology rather than simulating particles.
 * Corridors carry smoke first; the entrance and assembly route stay clear.
 */
export const SMOKE_PROFILES: Record<RoomId, SmokeProfile> = {
  outside: { startSeconds: Infinity, riseSeconds: 1, peakIntensity: 0 },
  entry: { startSeconds: Infinity, riseSeconds: 1, peakIntensity: 0 },
  lobby: { startSeconds: 18, riseSeconds: 72, peakIntensity: 0.48 },
  wcorr: { startSeconds: 7, riseSeconds: 58, peakIntensity: 0.78 },
  ecorr: { startSeconds: 28, riseSeconds: 50, peakIntensity: 0.7 },
  sec: { startSeconds: 0, riseSeconds: 70, peakIntensity: 1 },
  vault: { startSeconds: 42, riseSeconds: 55, peakIntensity: 0.42 },
  annex: { startSeconds: 0, riseSeconds: 42, peakIntensity: 0.5 },
  // hot smoke rises: the tall hall fills slowly, but it does fill
  atrium: { startSeconds: 30, riseSeconds: 80, peakIntensity: 0.4 },
  library: { startSeconds: 22, riseSeconds: 64, peakIntensity: 0.6 },
  cafe: { startSeconds: 36, riseSeconds: 70, peakIntensity: 0.45 },
};

/** The logical east route is represented physically by the east passage. */
export const BLOCKED_ROUTE = {
  from: "lobby" as const,
  to: "ecorr" as const,
  label: "East route",
  afterSeconds: ROUTE_BLOCK_AFTER_SECONDS,
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const elapsed = (seconds: number) =>
  Number.isFinite(seconds) ? Math.max(0, seconds) : 0;

/** Return the authored smoke intensity for one sector at a point in the run. */
export function getSectorSmoke(roomId: RoomId, elapsedSeconds: number): number {
  const profile = SMOKE_PROFILES[roomId];
  if (!profile || profile.peakIntensity <= 0 || !Number.isFinite(profile.startSeconds))
    return 0;

  const progress = clamp(
    (elapsed(elapsedSeconds) - profile.startSeconds) / profile.riseSeconds,
    0,
    1,
  );
  // Smooth the start and finish so both the fog and air drain change gently.
  const eased = progress * progress * (3 - 2 * progress);
  return clamp(profile.peakIntensity * eased, 0, 1);
}

/** The route is undirected, so either direction reports the same state. */
export function isRouteBlocked(
  fromRoom: RoomId,
  toRoom: RoomId,
  elapsedSeconds: number,
): boolean {
  const isEastRoute =
    (fromRoom === BLOCKED_ROUTE.from && toRoom === BLOCKED_ROUTE.to) ||
    (fromRoom === BLOCKED_ROUTE.to && toRoom === BLOCKED_ROUTE.from);
  return isEastRoute && elapsed(elapsedSeconds) >= BLOCKED_ROUTE.afterSeconds;
}
