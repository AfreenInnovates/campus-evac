import type { RoomId, Vec3 } from "./level";

/**
 * Every lamp in the building that actually casts light. They are not mounted one-to-one:
 * a small pool of real point lights (`LightPool.tsx`) is moved to whichever of these are
 * nearest the evacuee. Each extra point light costs every lit pixel on screen, so eighteen
 * of them - most behind walls, where they only leaked through - made the scene heavy.
 */
export interface RoomLight {
  room: RoomId;
  position: Vec3;
  intensity: number;
  distance: number;
  decay: number;
  color: string;
}

export const ROOM_LIGHTS: RoomLight[] = [
  /* entrance and corridor */
  { room: "entry", position: [0, 3, 8.8], intensity: 5, distance: 9, decay: 2, color: "#fff1dc" },
  { room: "lobby", position: [0, 3.1, 0.5], intensity: 8, distance: 14, decay: 2, color: "#fff1dc" },
  /* chemistry lab */
  { room: "sec", position: [-15, 2.9, -1.8], intensity: 9, distance: 13, decay: 2, color: "#fff1dc" },
  { room: "sec", position: [-15, 2.9, 3.6], intensity: 6, distance: 11, decay: 2, color: "#ffe6c9" },
  /* classroom */
  { room: "vault", position: [13, 3, -1], intensity: 6, distance: 12, decay: 2, color: "#fff1dc" },
  { room: "vault", position: [17.5, 3, -1], intensity: 6, distance: 12, decay: 2, color: "#fff1dc" },
  /* main hall */
  { room: "atrium", position: [0, 5.6, -10], intensity: 16, distance: 20, decay: 1.8, color: "#ffd6a8" },
  { room: "atrium", position: [0, 5.6, -17], intensity: 12, distance: 18, decay: 1.8, color: "#ffc896" },
  { room: "atrium", position: [0, 3.2, -23.3], intensity: 5, distance: 10, decay: 2, color: "#ffb070" },
  /* library */
  { room: "library", position: [-15, 2.9, -12.4], intensity: 7, distance: 11, decay: 2, color: "#ffdcae" },
  { room: "library", position: [-16, 2.9, -21], intensity: 6, distance: 10, decay: 2, color: "#ffe6c9" },
  /* cafeteria */
  { room: "cafe", position: [15.5, 3, -16.8], intensity: 9, distance: 14, decay: 2, color: "#fff1dc" },
  { room: "cafe", position: [15, 2.6, -22.6], intensity: 5, distance: 8, decay: 2, color: "#ffd2a0" },
  /* plaza lamp posts */
  { room: "outside", position: [-7.78, 3.8, 14], intensity: 14, distance: 14, decay: 2, color: "#ffc98f" },
  { room: "outside", position: [9.22, 3.8, 14], intensity: 14, distance: 14, decay: 2, color: "#ffc98f" },
];
