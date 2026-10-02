import { WARDEN_SECTORS, type DrillRoom, type Participant } from "./types";

/** Small deterministic PRNG so every client resolves the same role draw. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One evacuee and one or more sector-scoped wardens, derived from the drill seed. */
export function assignRoles(
  participants: Participant[],
  seed: number,
): Participant[] {
  if (participants.length === 0) return participants;
  const rng = mulberry32(seed);
  const order = [...participants].sort((a, b) => a.id.localeCompare(b.id));
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }

  const [evacuee, ...wardens] = order;
  const assigned: Participant[] = [
    { ...evacuee, role: "evacuee", sectorId: null },
    ...wardens.map((participant, index) => ({
      ...participant,
      role: "warden" as const,
      sectorId: WARDEN_SECTORS[index % WARDEN_SECTORS.length],
    })),
  ];

  // Keep join order stable so the lobby does not jump when roles are drawn.
  return participants.map(
    (participant) => assigned.find((item) => item.id === participant.id)!,
  );
}

/** Resolve the preparation clock without relying on a particular browser tab. */
export function resolveRoom(room: DrillRoom | null): DrillRoom | null {
  if (!room) return null;
  if (room.phase !== "preparing" || room.startsAt === null) return room;
  if (Date.now() < room.startsAt) return room;
  return {
    ...room,
    phase: "active",
    startsAt: null,
    participants: assignRoles(room.participants, room.seed),
  };
}
