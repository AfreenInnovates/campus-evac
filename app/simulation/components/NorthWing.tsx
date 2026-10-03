"use client";

import { useMemo, type ReactNode } from "react";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import * as THREE from "three";
import { ATRIUM_H, EAST_EXIT_Z, MEZZANINE, WEST_EXIT_Z, type Vec3 } from "../level";
import { useSimulation } from "../store";
import { plaster, wood } from "../textures";
import {
  Banner,
  Bench,
  ExitSign,
  FireAlarm,
  Glow,
  HangingSign,
  PaintedSign,
  PendantLight,
  PottedPlant,
  SunsetWindow,
  hdr,
} from "./Decor";
import { CeilingLight, Chair, Desk, FloorMark, Plant, Sofa, WallClock, WaterCooler } from "./Furniture";

/**
 * The north wing: a double-height Main Hall behind the central corridor, with the Library
 * off its west side and the Cafeteria off its east. None of it is on the drill's critical
 * path - it is room to explore, and somewhere for the smoke to go.
 */

const INK = "#231c2b";
const CORAL = "#ff6a3d";
const MINT = "#2fd18f";
const SUN = "#ffc44d";
const VIOLET = "#7b5cff";

function OnWalls({ children }: { children: ReactNode }) {
  const warden = useSimulation((s) => s.mode.kind === "warden");
  return <group visible={!warden}>{children}</group>;
}

function EvacueeOnly({ children }: { children: ReactNode }) {
  const evacueeView = useSimulation((s) => s.view === "evacuee");
  return <group visible={evacueeView}>{children}</group>;
}

/** A fire-exit doorway in an outer wall: push bar frame, green running-man sign. Local +Z faces in. */
export function FireExit({ position, rotationY }: { position: Vec3; rotationY: number }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {[-0.95, 0.95].map((x) => (
        <mesh key={x} position={[x, 1.25, 0.05]}>
          <boxGeometry args={[0.1, 2.5, 0.12]} />
          <meshStandardMaterial color="#2f8a4f" roughness={0.5} />
        </mesh>
      ))}
      <mesh position={[0, 2.52, 0.05]}>
        <boxGeometry args={[2, 0.1, 0.12]} />
        <meshStandardMaterial color="#2f8a4f" roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.012, 1]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1.8, 2]} />
        <meshBasicMaterial color="#39ff88" transparent opacity={0.25} toneMapped={false} />
      </mesh>
      <OnWalls>
      <PaintedSign
        id={`fire-exit-${position[0] < 0 ? "west" : "east"}`}
        position={[0, 2.95, 0.08]}
        width={1.5}
        height={0.42}
        background="#11a352"
        icon="running"
        iconColor="#ffffff"
        padding={0.08}
        lines={[{ text: "FIRE EXIT", size: 0.34, color: "#ffffff", weight: 900, tracking: 0.03 }]}
      />
      </OnWalls>
    </group>
  );
}

/* ---------------------------------------------------------------- main hall */

const STAIR = { x: 0, width: 3.2, fromZ: -13.7, steps: 14 };
const STAIR_RUN = (MEZZANINE.maxZ - STAIR.fromZ) / STAIR.steps; // negative: climbs toward -z
const STAIR_RISE = MEZZANINE.y / STAIR.steps;

/**
 * The walkable incline under the drawn steps: from half a step up at the foot to flush with
 * the mezzanine at the top, extended down into the floor so the foot has no lip.
 */
const RAMP = (() => {
  const z0 = STAIR.fromZ;
  const y0 = STAIR_RISE / 2;
  const z1 = MEZZANINE.maxZ;
  const y1 = MEZZANINE.y;
  const length = Math.hypot(z1 - z0, y1 - y0);
  const angle = Math.atan2(y1 - y0, z0 - z1);
  const extend = 0.8;
  const uz = (z1 - z0) / length;
  const uy = (y1 - y0) / length;
  const thickness = 0.05;
  return {
    angle,
    half: (length + extend) / 2,
    thickness,
    // midpoint of the extended run, pushed down so the top face lies on the line
    z: (z0 - uz * extend + z1) / 2 - Math.sin(angle) * thickness,
    y: (y0 - uy * extend + y1) / 2 - Math.cos(angle) * thickness,
  };
})();

const PILLARS: Vec3[] = [
  [-4.6, 0, -11.5],
  [4.6, 0, -11.5],
  [-4.6, 0, -18],
  [4.6, 0, -18],
];

function Pillar({ position }: { position: Vec3 }) {
  return (
    <group position={position}>
      <mesh position={[0, ATRIUM_H / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.7, ATRIUM_H, 0.7]} />
        <meshStandardMaterial map={plaster("#cfc5cc", 0.7, ATRIUM_H)} roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.06, 0]}>
        <boxGeometry args={[0.9, 0.12, 0.9]} />
        <meshStandardMaterial color="#3c3340" roughness={0.6} />
      </mesh>
    </group>
  );
}

/** A wide stair up to the mezzanine. The steps are drawn; the feet walk a smooth ramp under them. */
function GrandStair() {
  const length = Math.hypot(STAIR_RUN * STAIR.steps, MEZZANINE.y);
  const angle = Math.atan2(MEZZANINE.y, -STAIR_RUN * STAIR.steps);
  const midZ = STAIR.fromZ + (STAIR_RUN * STAIR.steps) / 2;
  const tread = wood("#6d4a33", STAIR.width, 0.5);
  return (
    <group>
      {Array.from({ length: STAIR.steps }, (_, i) => {
        const top = STAIR_RISE * (i + 1);
        return (
          <mesh
            key={i}
            position={[STAIR.x, top / 2, STAIR.fromZ + STAIR_RUN * (i + 0.5)]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[STAIR.width, top, Math.abs(STAIR_RUN) + 0.01]} />
            <meshStandardMaterial map={tread} roughness={0.7} />
          </mesh>
        );
      })}
      {/* handrails */}
      {[-1, 1].map((side) => (
        <group key={side}>
          <mesh
            position={[STAIR.x + side * (STAIR.width / 2 + 0.05), MEZZANINE.y / 2 + 0.95, midZ]}
            rotation={[angle, 0, 0]}
          >
            <boxGeometry args={[0.06, 0.06, length]} />
            <meshStandardMaterial color="#c9c1cc" metalness={0.8} roughness={0.25} />
          </mesh>
          <mesh
            position={[STAIR.x + side * (STAIR.width / 2 + 0.05), MEZZANINE.y / 2 + 0.45, midZ]}
            rotation={[angle, 0, 0]}
          >
            <boxGeometry args={[0.03, 0.95, length]} />
            <meshStandardMaterial color="#bfe3ff" transparent opacity={0.18} roughness={0.05} metalness={0.3} />
          </mesh>
        </group>
      ))}
      <RigidBody type="fixed" colliders={false}>
        {/* walkable ramp: its top surface runs through the middle of each step */}
        <CuboidCollider
          position={[STAIR.x, RAMP.y, RAMP.z]}
          rotation={[RAMP.angle, 0, 0]}
          args={[STAIR.width / 2, RAMP.thickness, RAMP.half]}
        />
        {/* side walls so nobody steps off the stair halfway up */}
        {[-1, 1].map((side) => (
          <CuboidCollider
            key={side}
            position={[STAIR.x + side * (STAIR.width / 2 + 0.05), MEZZANINE.y / 2 + 0.6, midZ]}
            rotation={[angle, 0, 0]}
            args={[0.05, 0.6, length / 2]}
          />
        ))}
      </RigidBody>
    </group>
  );
}

function Mezzanine() {
  const m = MEZZANINE;
  const w = m.maxX - m.minX;
  const d = m.maxZ - m.minZ;
  const cz = (m.minZ + m.maxZ) / 2;
  const railSegments: [number, number][] = [
    [m.minX, STAIR.x - STAIR.width / 2],
    [STAIR.x + STAIR.width / 2, m.maxX],
  ];
  return (
    <group>
      <mesh position={[0, m.y - 0.15, cz]} castShadow receiveShadow>
        <boxGeometry args={[w, 0.3, d]} />
        <meshStandardMaterial map={wood("#7a5538", w, d)} roughness={0.75} />
      </mesh>
      {/* warm strip under the balcony edge */}
      <mesh position={[0, m.y - 0.32, m.maxZ - 0.05]}>
        <boxGeometry args={[w, 0.04, 0.08]} />
        <meshBasicMaterial color={hdr("#ffb46a", 2.2)} toneMapped={false} />
      </mesh>
      {railSegments.map(([a, b]) => (
        <group key={a}>
          <mesh position={[(a + b) / 2, m.y + 1.05, m.maxZ - 0.05]}>
            <boxGeometry args={[b - a, 0.06, 0.08]} />
            <meshStandardMaterial color="#c9c1cc" metalness={0.8} roughness={0.25} />
          </mesh>
          <mesh position={[(a + b) / 2, m.y + 0.52, m.maxZ - 0.05]}>
            <boxGeometry args={[b - a, 1.0, 0.03]} />
            <meshStandardMaterial color="#bfe3ff" transparent opacity={0.16} roughness={0.05} metalness={0.3} />
          </mesh>
        </group>
      ))}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider position={[0, m.y - 0.15, cz]} args={[w / 2, 0.15, d / 2]} />
        {railSegments.map(([a, b]) => (
          <CuboidCollider key={a} position={[(a + b) / 2, m.y + 0.6, m.maxZ - 0.05]} args={[(b - a) / 2, 0.6, 0.06]} />
        ))}
      </RigidBody>
      <RigidBody type="fixed" colliders="cuboid">
        <Sofa position={[-5.2, m.y, -24.3]} />
        <Sofa position={[5.2, m.y, -24.3]} />
      </RigidBody>
      <PottedPlant position={[-7.4, m.y, -22.2]} scale={1.1} />
      <PottedPlant position={[7.4, m.y, -22.2]} scale={1.1} />
    </group>
  );
}

function MainHall() {
  return (
    <group>
      {PILLARS.map((p) => (
        <Pillar key={`${p[0]}${p[2]}`} position={p} />
      ))}
      <RigidBody type="fixed" colliders={false}>
        {PILLARS.map(([x, , z]) => (
          <CuboidCollider key={`${x}${z}`} position={[x, ATRIUM_H / 2, z]} args={[0.35, ATRIUM_H / 2, 0.35]} />
        ))}
      </RigidBody>
      <GrandStair />
      <Mezzanine />

      {/* floor inlay: a compass rose under the skylight */}
      <mesh position={[0, 0.012, -11]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.9, 2.2, 64]} />
        <meshStandardMaterial color="#b8894a" metalness={0.6} roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.011, -11]} rotation={[-Math.PI / 2, 0, Math.PI / 4]}>
        <ringGeometry args={[0, 1.9, 4]} />
        <meshStandardMaterial color="#3a2f45" roughness={0.5} />
      </mesh>
      <FloorMark position={[0, 0, -8.6]} size={[0.3, 2.6]} color={MINT} opacity={0.45} />

      <RigidBody type="fixed" colliders="cuboid">
        <Bench position={[-6.9, 0, -14.2]} rotationY={Math.PI / 2} />
        <Bench position={[6.9, 0, -14.2]} rotationY={-Math.PI / 2} />
      </RigidBody>
      <Plant position={[-6.9, 0, -8]} scale={1.4} />
      <Plant position={[6.9, 0, -8]} scale={1.4} />
      <WaterCooler position={[7.4, 0, -20.5]} />

      <OnWalls>
        {/* tall windows above the mezzanine, facing the sunset */}
        {[-5, 0, 5].map((x) => (
          <SunsetWindow key={x} id={`hall-high-${x}`} position={[x, MEZZANINE.y, -24.84]} width={3.4} height={2.8} sill={0.6} />
        ))}
        <PaintedSign
          id="hall-to-library"
          position={[-7.83, 3.1, -16]}
          rotationY={Math.PI / 2}
          width={2.4}
          height={0.56}
          background={INK}
          border={VIOLET}
          padding={0.12}
          lines={[{ text: "LIBRARY", size: 0.4, color: "#fff6ea", weight: 900, tracking: 0.03 }]}
        />
        <PaintedSign
          id="hall-to-cafe"
          position={[7.83, 3.1, -17.5]}
          rotationY={-Math.PI / 2}
          width={2.4}
          height={0.56}
          background={INK}
          border={SUN}
          padding={0.12}
          lines={[{ text: "CAFETERIA", size: 0.4, color: "#fff6ea", weight: 900, tracking: 0.03 }]}
        />
        <FireAlarm position={[-7.83, 1.35, -10]} rotationY={Math.PI / 2} />
        <FireAlarm position={[7.83, 1.35, -10]} rotationY={-Math.PI / 2} />
        <WallClock position={[7.78, 5.2, -13]} rotationY={-Math.PI / 2} />
      </OnWalls>

      <EvacueeOnly>
        {/* on the south wall, which the overhead views cut away */}
        <Banner
          id="hall-banner"
          position={[0, 6.1, -7.2]}
          rotationY={Math.PI}
          width={5.2}
          height={1.1}
          background={INK}
          lines={[
            { text: "MAIN HALL", size: 0.44, color: "#fff6ea", weight: 900, tracking: 0.04 },
            { text: "LIBRARY  WEST  /  CAFETERIA  EAST", size: 0.2, color: SUN, weight: 800, tracking: 0.02 },
          ]}
        />
        <ExitSign position={[0, 3.35, -7.2]} rotationY={Math.PI} scale={0.9} />
        {/* skylight: a warm panel set into the high ceiling */}
        <mesh position={[0, ATRIUM_H - 0.02, -13]} rotation={[Math.PI / 2, 0, 0]}>
          <planeGeometry args={[6, 6]} />
          <meshBasicMaterial color={hdr("#ffb27d", 1.8)} toneMapped={false} />
        </mesh>
        {[-3, 0, 3].map((x) => (
          <mesh key={x} position={[x, ATRIUM_H - 0.08, -13]}>
            <boxGeometry args={[0.12, 0.14, 6]} />
            <meshStandardMaterial color="#2e2634" roughness={0.6} />
          </mesh>
        ))}
        {/* hanging globe lamps */}
        {(
          [
            [-2.6, -10],
            [2.6, -10],
            [-2.6, -16],
            [2.6, -16],
          ] as [number, number][]
        ).map(([x, z]) => (
          <group key={`${x}${z}`} position={[x, 5.3, z]}>
            <mesh position={[0, (ATRIUM_H - 5.3) / 2, 0]}>
              <cylinderGeometry args={[0.008, 0.008, ATRIUM_H - 5.3, 4]} />
              <meshBasicMaterial color="#2a2530" />
            </mesh>
            <mesh>
              <sphereGeometry args={[0.32, 20, 14]} />
              <meshBasicMaterial color={hdr("#ffd9a8", 2.4)} toneMapped={false} />
            </mesh>
            <Glow position={[0, 0, 0]} color="#ffc98a" size={2.2} opacity={0.35} />
          </group>
        ))}
      </EvacueeOnly>
    </group>
  );
}

/* ------------------------------------------------------------------ library */

/** Book spines, drawn once and shared by every stack. */
let spines: THREE.CanvasTexture | null = null;
function bookSpines() {
  if (spines) return spines;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const colors = ["#7a3b33", "#2f4f6f", "#3f6a4a", "#8a6a2f", "#5a3a66", "#9b5a3a", "#2e3a4a", "#6a2f3f", "#c9b48a"];
  let seed = 5;
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  ctx.fillStyle = "#3a2a22";
  ctx.fillRect(0, 0, 512, 256);
  const rows = 4;
  const rowH = 256 / rows;
  for (let r = 0; r < rows; r++) {
    let x = 0;
    while (x < 512) {
      const w = 6 + rnd() * 12;
      const h = rowH * (0.62 + rnd() * 0.3);
      ctx.fillStyle = colors[Math.floor(rnd() * colors.length)];
      ctx.fillRect(x, (r + 1) * rowH - 6 - h, w - 1, h);
      ctx.fillStyle = "rgba(255,240,200,0.25)";
      ctx.fillRect(x + 1, (r + 1) * rowH - 6 - h * 0.7, w - 3, 2);
      x += w;
    }
    ctx.fillStyle = "#4e382c";
    ctx.fillRect(0, (r + 1) * rowH - 6, 512, 6);
  }
  spines = new THREE.CanvasTexture(canvas);
  spines.colorSpace = THREE.SRGBColorSpace;
  spines.anisotropy = 4;
  return spines;
}

/** A double-sided stack running along z; `alongX` turns it to run along x. */
function Bookcase({
  position,
  length = 4.4,
  height = 2.5,
  alongX = false,
}: {
  position: Vec3;
  length?: number;
  height?: number;
  alongX?: boolean;
}) {
  const books = useMemo(() => bookSpines(), []);
  return (
    <group position={position} rotation={[0, alongX ? Math.PI / 2 : 0, 0]}>
      <mesh position={[0, height / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.62, height, length]} />
        <meshStandardMaterial color="#4a3428" roughness={0.8} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 0.315, height / 2, 0]} rotation={[0, (side * Math.PI) / 2, 0]}>
          <planeGeometry args={[length - 0.1, height - 0.1]} />
          <meshStandardMaterial map={books} roughness={0.85} />
        </mesh>
      ))}
      <mesh position={[0, height + 0.04, 0]}>
        <boxGeometry args={[0.7, 0.08, length + 0.08]} />
        <meshStandardMaterial map={wood("#6d4a33", 0.7, length)} roughness={0.7} />
      </mesh>
    </group>
  );
}

function ReadingTable({ position }: { position: Vec3 }) {
  return (
    <group position={position}>
      <Desk position={[0, 0, 0]} size={[2.8, 0.76, 1.2]} />
      {[-0.8, 0.8].flatMap((x) =>
        [-1, 1].map((side) => (
          <Chair key={`${x}${side}`} position={[x, 0, side * 0.95]} rotationY={side > 0 ? Math.PI : 0} />
        )),
      )}
      {/* green reading lamps */}
      {[-0.7, 0.7].map((x) => (
        <group key={x} position={[x, 0.8, 0]}>
          <mesh position={[0, 0.16, 0]}>
            <cylinderGeometry args={[0.015, 0.015, 0.32, 6]} />
            <meshStandardMaterial color="#b8894a" metalness={0.7} roughness={0.3} />
          </mesh>
          <mesh position={[0, 0.34, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.08, 0.1, 0.36, 12, 1, true]} />
            <meshStandardMaterial color="#1f6b45" side={THREE.DoubleSide} roughness={0.4} />
          </mesh>
          <mesh position={[0, 0.3, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.3, 0.12]} />
            <meshBasicMaterial color={hdr("#ffe2b0", 2.4)} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

const STACK_ROWS = [-19.6, -17.2, -14.8, -12.4];

function Library() {
  return (
    <group>
      {STACK_ROWS.map((x) => (
        <Bookcase key={x} position={[x, 0, -21.1]} length={5} />
      ))}
      {/* wall shelving along the north wall */}
      <Bookcase position={[-15, 0, -24.5]} length={12} height={3} alongX />
      <RigidBody type="fixed" colliders={false}>
        {STACK_ROWS.map((x) => (
          <CuboidCollider key={x} position={[x, 1.25, -21.1]} args={[0.31, 1.25, 2.5]} />
        ))}
        <CuboidCollider position={[-15, 1.5, -24.5]} args={[6, 1.5, 0.31]} />
        <CuboidCollider position={[-15, 0.4, -14.5]} args={[1.45, 0.4, 0.62]} />
        <CuboidCollider position={[-15, 0.4, -10.4]} args={[1.45, 0.4, 0.62]} />
        <CuboidCollider position={[-11, 0.5, -9.1]} args={[1.2, 0.5, 0.5]} />
      </RigidBody>
      <ReadingTable position={[-15, 0, -14.5]} />
      <ReadingTable position={[-15, 0, -10.4]} />

      {/* circulation desk by the door */}
      <group position={[-11, 0, -9.1]}>
        <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
          <boxGeometry args={[2.4, 1, 1]} />
          <meshStandardMaterial map={wood("#7a5236", 2.4, 1)} roughness={0.6} />
        </mesh>
        <mesh position={[0, 1.03, 0]}>
          <boxGeometry args={[2.5, 0.06, 1.1]} />
          <meshStandardMaterial color="#e8dfd2" roughness={0.4} />
        </mesh>
      </group>
      <RigidBody type="fixed" colliders="cuboid">
        <Sofa position={[-20.6, 0, -12.5]} rotationY={Math.PI / 2} />
      </RigidBody>
      <FireExit position={[-21.84, 0, WEST_EXIT_Z]} rotationY={Math.PI / 2} />
      <PottedPlant position={[-8.8, 0, -24.2]} />

      <OnWalls>
        <SunsetWindow id="library-west-a" position={[-21.84, 0, -11.9]} rotationY={Math.PI / 2} width={2.8} />
        <SunsetWindow id="library-west-b" position={[-21.84, 0, -16.4]} rotationY={Math.PI / 2} width={3} />
        <PaintedSign
          id="library-quiet"
          position={[-8.17, 2.2, -11.5]}
          rotationY={-Math.PI / 2}
          width={1.6}
          height={0.9}
          background="#fff6ea"
          border={INK}
          align="left"
          valign="top"
          padding={0.09}
          lines={[
            { text: "QUIET PLEASE", size: 0.13, color: VIOLET, weight: 900 },
            { text: "In an alarm, leave your", size: 0.075, color: INK, weight: 700, gap: 0.05 },
            { text: "books. Walk to the hall,", size: 0.075, color: INK, weight: 700, gap: 0.02 },
            { text: "then south to the exit.", size: 0.075, color: INK, weight: 700, gap: 0.02 },
          ]}
        />
        <ExitSign position={[-8.17, 2.9, -16]} rotationY={-Math.PI / 2} scale={0.8} />
        <FireAlarm position={[-8.17, 1.35, -19.2]} rotationY={-Math.PI / 2} />
        <WallClock position={[-21.78, 2.6, -13.6]} rotationY={Math.PI / 2} />
      </OnWalls>
      <EvacueeOnly>
        <HangingSign
          id="library-name"
          position={[-15, 3.1, -18.2]}
          width={2}
          height={0.44}
          drop={0.25}
          background={INK}
          border={VIOLET}
          padding={0.12}
          lines={[{ text: "LIBRARY", size: 0.4, color: "#fff6ea", weight: 900, tracking: 0.04 }]}
        />
        {STACK_ROWS.slice(0, 3).map((x) => (
          <PendantLight key={x} position={[x + 1.2, 3.25, -21.4]} rotationY={Math.PI / 2} length={3} />
        ))}
        <PendantLight position={[-15, 3.1, -14.5]} length={2.4} />
        <PendantLight position={[-15, 3.1, -10.4]} length={2.4} />
      </EvacueeOnly>
    </group>
  );
}

/* ---------------------------------------------------------------- cafeteria */

const TABLE_ROWS = [-20.4, -16.8, -13.2];

function LongTable({ position }: { position: Vec3 }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.76, 0]} castShadow receiveShadow>
        <boxGeometry args={[6, 0.07, 1.1]} />
        <meshStandardMaterial color="#e9e2d6" roughness={0.45} />
      </mesh>
      {[-2.6, 0, 2.6].map((x) => (
        <mesh key={x} position={[x, 0.38, 0]}>
          <boxGeometry args={[0.08, 0.76, 0.8]} />
          <meshStandardMaterial color="#3a3340" metalness={0.5} roughness={0.4} />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[0, 0.44, side * 0.85]} castShadow>
          <boxGeometry args={[5.6, 0.06, 0.34]} />
          <meshStandardMaterial map={wood("#9b6b47", 5.6, 0.34)} roughness={0.7} />
        </mesh>
      ))}
      {/* trays and cups */}
      {[-2, -0.6, 0.9, 2.2].map((x, i) => (
        <group key={x} position={[x, 0.8, i % 2 ? 0.25 : -0.25]}>
          <mesh>
            <boxGeometry args={[0.45, 0.02, 0.32]} />
            <meshStandardMaterial color={["#e05a4a", "#3a86c8", "#f0b43a", "#44a46a"][i]} roughness={0.5} />
          </mesh>
          <mesh position={[0.12, 0.06, 0]}>
            <cylinderGeometry args={[0.04, 0.035, 0.1, 10]} />
            <meshStandardMaterial color="#f4efe6" roughness={0.3} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function VendingMachine({ position, rotationY = 0, glow }: { position: Vec3; rotationY?: number; glow: string }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh position={[0, 0.95, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.95, 1.9, 0.8]} />
        <meshStandardMaterial color="#2a2530" roughness={0.5} metalness={0.3} />
      </mesh>
      <mesh position={[-0.1, 1.1, 0.41]}>
        <planeGeometry args={[0.6, 1.3]} />
        <meshBasicMaterial color={hdr(glow, 1.6)} toneMapped={false} />
      </mesh>
      <mesh position={[0.34, 1.2, 0.41]}>
        <planeGeometry args={[0.14, 0.5]} />
        <meshStandardMaterial color="#8a8190" metalness={0.6} roughness={0.3} />
      </mesh>
      <Glow position={[0, 1.1, 0.7]} color={glow} size={1.8} opacity={0.3} />
    </group>
  );
}

function Cafeteria() {
  return (
    <group>
      <RigidBody type="fixed" colliders={false}>
        {TABLE_ROWS.map((z) => (
          <CuboidCollider key={z} position={[15.5, 0.4, z]} args={[3, 0.4, 1.05]} />
        ))}
        {/* serving counter */}
        <CuboidCollider position={[15, 0.55, -23.6]} args={[4.6, 0.55, 0.55]} />
        <CuboidCollider position={[9.2, 0.95, -10.65]} args={[0.48, 0.95, 0.4]} />
        <CuboidCollider position={[10.3, 0.95, -10.65]} args={[0.48, 0.95, 0.4]} />
      </RigidBody>
      {TABLE_ROWS.map((z) => (
        <LongTable key={z} position={[15.5, 0, z]} />
      ))}

      <group position={[15, 0, -23.6]}>
        <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
          <boxGeometry args={[9.2, 1, 1.1]} />
          <meshStandardMaterial color="#c9573c" roughness={0.6} />
        </mesh>
        <mesh position={[0, 1.03, 0]}>
          <boxGeometry args={[9.3, 0.06, 1.2]} />
          <meshStandardMaterial color="#d6d2cc" metalness={0.5} roughness={0.25} />
        </mesh>
        {/* sneeze guard */}
        <mesh position={[0, 1.45, 0.3]}>
          <boxGeometry args={[9, 0.7, 0.03]} />
          <meshStandardMaterial color="#cfe6f2" transparent opacity={0.2} roughness={0.05} metalness={0.3} />
        </mesh>
        {[-3.4, -1.7, 0, 1.7, 3.4].map((x, i) => (
          <mesh key={x} position={[x, 1.1, -0.1]}>
            <boxGeometry args={[1.3, 0.1, 0.7]} />
            <meshStandardMaterial color={["#e0b050", "#8ab45a", "#d0703a", "#c8c0a0", "#b04a3a"][i]} roughness={0.7} />
          </mesh>
        ))}
      </group>
      <VendingMachine position={[9.2, 0, -10.65]} rotationY={Math.PI} glow="#6fd0ff" />
      <VendingMachine position={[10.3, 0, -10.65]} rotationY={Math.PI} glow="#ff8a5c" />
      <PottedPlant position={[21.3, 0, -10.8]} scale={1.1} />
      <FireExit position={[21.84, 0, EAST_EXIT_Z]} rotationY={-Math.PI / 2} />
      <PottedPlant position={[21.3, 0, -24.3]} scale={1.1} />

      <OnWalls>
        <SunsetWindow id="cafe-east-a" position={[21.84, 0, -13.5]} rotationY={-Math.PI / 2} width={3.2} />
        <SunsetWindow id="cafe-east-b" position={[21.84, 0, -19.5]} rotationY={-Math.PI / 2} width={3.2} />
        <PaintedSign
          id="cafe-menu"
          position={[15, 2.55, -24.83]}
          width={5}
          height={1.3}
          background={INK}
          border={SUN}
          align="left"
          valign="top"
          padding={0.1}
          lines={[
            { text: "CAFETERIA", size: 0.26, color: SUN, weight: 900, tracking: 0.03 },
            { text: "Today: pasta bake / dal & rice / fruit", size: 0.11, color: "#fff6ea", weight: 700, gap: 0.06 },
            { text: "When the alarm sounds, leave your tray.", size: 0.11, color: CORAL, weight: 700, gap: 0.04 },
          ]}
        />
        <ExitSign position={[8.17, 2.9, -17.5]} rotationY={Math.PI / 2} scale={0.8} />
        <FireAlarm position={[8.17, 1.35, -21]} rotationY={Math.PI / 2} />
        <WallClock position={[21.78, 2.7, -16.5]} rotationY={-Math.PI / 2} />
      </OnWalls>
      <EvacueeOnly>
        {TABLE_ROWS.flatMap((z) =>
          [13, 18].map((x) => <CeilingLight key={`${x}${z}`} position={[x, 3.72, z]} />),
        )}
      </EvacueeOnly>
    </group>
  );
}

export default function NorthWing() {
  return (
    <>
      <MainHall />
      <Library />
      <Cafeteria />
    </>
  );
}
