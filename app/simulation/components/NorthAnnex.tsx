"use client";

import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { NCORR_Z, NORTH_EXIT_X, NORTH_Z, type Vec3 } from "../level";
import { wood } from "../textures";
import { ExitSign, FireAlarm, PaintedSign, PottedPlant, ProjectorScreen } from "./Decor";
import { Chair, Desk, Monitor, ServerRack, WallClock } from "./Furniture";
import { FireExit } from "./NorthWing";

/**
 * The north wing behind the Main Hall: a long corridor, a Lecture Theatre, a Computer Lab and
 * a Sports Hall with its own fire exit out to the sports field. Everything solid has a
 * collider, so evacuees route around it.
 */

const INK = "#16111e";

/* ------------------------------------------------------------------ lecture theatre */

/** One run of fixed seating: a long writing ledge with a bench behind it, facing the screen. */
function SeatRow({ x, z, length }: { x: number; z: number; length: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.78, 0]} castShadow receiveShadow>
        <boxGeometry args={[length, 0.06, 0.45]} />
        <meshStandardMaterial map={wood("#8a5a3a", length, 0.45)} roughness={0.55} />
      </mesh>
      <mesh position={[0, 0.4, -0.18]}>
        <boxGeometry args={[length, 0.76, 0.06]} />
        <meshStandardMaterial color="#4a3346" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.45, 0.55]} castShadow>
        <boxGeometry args={[length, 0.1, 0.45]} />
        <meshStandardMaterial color="#7c3b55" roughness={0.75} />
      </mesh>
      <mesh position={[0, 0.8, 0.78]} castShadow>
        <boxGeometry args={[length, 0.6, 0.08]} />
        <meshStandardMaterial color="#7c3b55" roughness={0.75} />
      </mesh>
    </group>
  );
}

const LECTURE_ROWS = [-39, -36.6, -34.2, -31.8];

function LectureTheatre() {
  return (
    <group>
      <RigidBody type="fixed" colliders={false}>
        {LECTURE_ROWS.flatMap((z) => [
          <CuboidCollider key={`w${z}`} position={[-18.6, 0.6, z + 0.3]} args={[2.4, 0.6, 0.65]} />,
          <CuboidCollider key={`e${z}`} position={[-9.4, 0.6, z + 0.3]} args={[2.4, 0.6, 0.65]} />,
        ])}
        <CuboidCollider position={[-17.5, 0.6, -41.4]} args={[0.7, 0.6, 0.45]} />
      </RigidBody>
      {LECTURE_ROWS.flatMap((z) => [<SeatRow key={`w${z}`} x={-18.6} z={z} length={4.8} />, <SeatRow key={`e${z}`} x={-9.4} z={z} length={4.8} />])}
      {/* lectern */}
      <group position={[-17.5, 0, -41.4]}>
        <mesh position={[0, 0.55, 0]} castShadow>
          <boxGeometry args={[1.2, 1.1, 0.7]} />
          <meshStandardMaterial map={wood("#5a3a26", 1.2, 1.1)} roughness={0.6} />
        </mesh>
      </group>
      <ProjectorScreen
        id="lecture-slide"
        position={[-12, 1.9, -42.8]}
        width={5}
        height={2.6}
        lines={[
          { text: "FIRE SAFETY 101", size: 0.36, color: "#ff6a3d", weight: 900 },
          { text: "Know two ways out of every room.", size: 0.16, color: INK, weight: 700, gap: 0.12 },
        ]}
      />
      <PottedPlant position={[-21.2, 0, -29.8]} />
      <WallClock position={[-21.78, 2.6, -36]} rotationY={Math.PI / 2} />
      <FireAlarm position={[-14.9, 1.35, NCORR_Z - 0.17]} rotationY={Math.PI} />
      <ExitSign position={[-14, 2.85, NCORR_Z - 0.17]} rotationY={Math.PI} scale={0.8} />
    </group>
  );
}

/* ------------------------------------------------------------------ computer lab */

const LAB_ROWS = [-32.6, -36.2, -39.8];

function ComputerLab() {
  return (
    <group>
      <RigidBody type="fixed" colliders={false}>
        {LAB_ROWS.flatMap((z) => [
          <CuboidCollider key={`w${z}`} position={[-3.5, 0.5, z]} args={[1.3, 0.5, 0.75]} />,
          <CuboidCollider key={`e${z}`} position={[3.5, 0.5, z]} args={[1.3, 0.5, 0.75]} />,
        ])}
      </RigidBody>
      {LAB_ROWS.flatMap((z) =>
        [-3.5, 3.5].map((x) => (
          <group key={`${x}${z}`}>
            <Desk position={[x, 0, z]} size={[2.5, 0.75, 0.8]} />
            <Monitor position={[x - 0.6, 0.79, z - 0.15]} feed="#1d4f7a" />
            <Monitor position={[x + 0.6, 0.79, z - 0.15]} feed="#1d6a4f" />
            <Chair position={[x - 0.6, 0, z + 0.7]} rotationY={Math.PI} />
            <Chair position={[x + 0.6, 0, z + 0.7]} rotationY={Math.PI} />
          </group>
        )),
      )}
      <ServerRack position={[-4.9, 0, -42.3]} />
      <PaintedSign
        id="complab-rules"
        position={[0, 2.3, -42.82]}
        width={2.6}
        height={0.8}
        background="#fff6ea"
        border={INK}
        lines={[
          { text: "COMPUTER LAB", size: 0.2, color: INK, weight: 900 },
          { text: "No food or drink near the workstations", size: 0.08, color: INK, weight: 700, gap: 0.06 },
        ]}
      />
      <FireAlarm position={[0.9, 1.35, NCORR_Z - 0.17]} rotationY={Math.PI} />
    </group>
  );
}

/* ------------------------------------------------------------------ sports hall */

function Line({ position, size, rotationY = 0 }: { position: Vec3; size: [number, number]; rotationY?: number }) {
  return (
    <mesh position={position} rotation={[-Math.PI / 2, 0, rotationY]}>
      <planeGeometry args={size} />
      <meshBasicMaterial color="#f5efe6" transparent opacity={0.85} />
    </mesh>
  );
}

function Hoop({ x, facing }: { x: number; facing: 1 | -1 }) {
  return (
    <group position={[x, 0, -36]}>
      <mesh position={[0, 1.6, 0]}>
        <boxGeometry args={[0.12, 3.2, 0.12]} />
        <meshStandardMaterial color="#3a3340" metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[facing * 0.35, 3.15, 0]}>
        <boxGeometry args={[0.05, 1.05, 1.8]} />
        <meshStandardMaterial color="#f4f4f4" roughness={0.4} />
      </mesh>
      <mesh position={[facing * 0.65, 2.85, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.23, 0.02, 6, 20]} />
        <meshStandardMaterial color="#ff6a3d" />
      </mesh>
    </group>
  );
}

function Bleachers({ x }: { x: number }) {
  return (
    <group position={[x, 0, -30.6]}>
      {[0, 1, 2].map((step) => (
        <mesh key={step} position={[0, 0.22 + step * 0.22, -step * 0.5]} castShadow receiveShadow>
          <boxGeometry args={[5, 0.44 + step * 0.44, 0.5]} />
          <meshStandardMaterial map={wood("#9b6b3f", 5, 0.5)} roughness={0.6} />
        </mesh>
      ))}
    </group>
  );
}

function SportsHall() {
  return (
    <group>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider position={[9.5, 0.4, -31.1]} args={[2.5, 0.4, 0.75]} />
        <CuboidCollider position={[18.5, 0.4, -31.1]} args={[2.5, 0.4, 0.75]} />
        <CuboidCollider position={[6.4, 1.6, -36]} args={[0.25, 1.6, 0.9]} />
        <CuboidCollider position={[21.6, 1.6, -36]} args={[0.25, 1.6, 0.9]} />
        <CuboidCollider position={[20.6, 0.5, -41.8]} args={[0.9, 0.5, 0.7]} />
      </RigidBody>
      {/* court markings */}
      <Line position={[14, 0.012, -36]} size={[0.08, 12]} />
      <Line position={[14, 0.012, -30]} size={[14, 0.08]} />
      <Line position={[14, 0.012, -42]} size={[14, 0.08]} />
      <Line position={[7, 0.012, -36]} size={[0.08, 12]} />
      <Line position={[21, 0.012, -36]} size={[0.08, 12]} />
      <mesh position={[14, 0.013, -36]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.7, 1.78, 48]} />
        <meshBasicMaterial color="#f5efe6" />
      </mesh>
      <Hoop x={6.4} facing={1} />
      <Hoop x={21.6} facing={-1} />
      <Bleachers x={9.5} />
      <Bleachers x={18.5} />
      {/* the equipment store the fire starts in: stacked mats and a ball cage */}
      <group position={[20.6, 0, -41.8]}>
        {[0, 1, 2, 3].map((i) => (
          <mesh key={i} position={[0, 0.12 + i * 0.24, 0]} castShadow>
            <boxGeometry args={[1.8, 0.22, 1.4]} />
            <meshStandardMaterial color={i % 2 ? "#2f5fa8" : "#3c75c8"} roughness={0.85} />
          </mesh>
        ))}
      </group>
      <FireExit position={[NORTH_EXIT_X, 0, NORTH_Z + 0.16]} rotationY={0} />
      <FireAlarm position={[12.6, 1.35, NORTH_Z + 0.17]} />
    </group>
  );
}

/* ------------------------------------------------------------------ corridor and field */

function NorthCorridor() {
  return (
    <group>
      <PaintedSign
        id="north-wing-sign"
        position={[-5.5, 2.95, -25.17]}
        rotationY={Math.PI}
        width={2.4}
        height={0.5}
        background="#2b2140"
        lines={[{ text: "NORTH WING", size: 0.26, color: "#ffc44d", weight: 900, tracking: 0.04 }]}
      />
      <PottedPlant position={[-21.3, 0, -27]} />
      <PottedPlant position={[21.3, 0, -27.8]} />
      <ExitSign position={[-5.5, 2.75, -25.17]} rotationY={Math.PI} scale={0.7} />
    </group>
  );
}

/** The sports field outside the north fire exit: somewhere to stand clear of the building. */
function SportsField() {
  return (
    <group>
      <mesh position={[0, 0.015, -50]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[60, 14]} />
        <meshStandardMaterial color="#4a6a45" roughness={1} />
      </mesh>
      <Line position={[0, 0.02, -45]} size={[44, 0.1]} />
      <mesh position={[NORTH_EXIT_X, 0.03, -48.5]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.6, 1.85, 40]} />
        <meshBasicMaterial color="#39ff88" transparent opacity={0.55} toneMapped={false} />
      </mesh>
    </group>
  );
}

export default function NorthAnnex() {
  return (
    <>
      <NorthCorridor />
      <LectureTheatre />
      <ComputerLab />
      <SportsHall />
      <SportsField />
    </>
  );
}
