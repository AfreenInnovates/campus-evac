"use client";

import { CuboidCollider, RigidBody } from "@react-three/rapier";
import type { ReactNode } from "react";
import type { Vec3 } from "../level";
import { useSimulation } from "../store";
import { HAND_FONT, wood } from "../textures";
import {
  BottleShelf,
  BulletinBoard,
  ExitSign,
  FireAlarm,
  HangingSign,
  LabIsland,
  PaintedSign,
  PendantLight,
  Poster,
  PottedPlant,
  Projector,
  ProjectorScreen,
  RecycleBin,
  Speaker,
  Stool,
  StudentDesk,
  SunsetWindow,
  WritingBoard,
  Banner,
  Bench,
  Beakers,
  Glow,
} from "./Decor";
import {
  Cabinet,
  CeilingLight,
  CeilingPipes,
  ClassroomPodium,
  ClimbableStack,
  Desk,
  EvacuationStair,
  FloorMark,
  FumeHood,
  GlassCabinet,
  Locker,
  MicroscopeStation,
  Plant,
  Reception,
  Shelf,
  Sofa,
  WallClock,
  WallTrim,
  WoodCrate,
} from "./Furniture";
import NorthWing from "./NorthWing";

const INK = "#231c2b";
const CORAL = "#ff6a3d";
const VIOLET = "#7b5cff";
const MINT = "#2fd18f";
const SUN = "#ffc44d";

/**
 * Wall-mounted decor. The warden's walls are cut down to knee height, so anything hung on
 * them would float; south walls and ceilings are only drawn in the evacuee's own view.
 */
function OnWalls({ children }: { children: ReactNode }) {
  const warden = useSimulation((s) => s.mode.kind === "warden");
  return <group visible={!warden}>{children}</group>;
}

function EvacueeOnly({ children }: { children: ReactNode }) {
  const evacueeView = useSimulation((s) => s.view === "evacuee");
  return <group visible={evacueeView}>{children}</group>;
}

/** A doorway between blocks, with the destination painted above it. Local +Z faces the viewer. */
function Doorway({
  id,
  position,
  rotationY,
  title,
  sub,
  color,
  icon = null,
}: {
  id: string;
  position: Vec3;
  rotationY: number;
  title: string;
  sub: string;
  color: string;
  icon?: "flask" | "molecule" | null;
}) {
  const trim = wood("#7a5236", 1, 3);
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {[-0.92, 0.92].map((x) => (
        <mesh key={x} position={[x, 1.25, 0.17]} castShadow>
          <boxGeometry args={[0.12, 2.5, 0.06]} />
          <meshStandardMaterial map={trim} roughness={0.6} />
        </mesh>
      ))}
      <mesh position={[0, 2.46, 0.17]}>
        <boxGeometry args={[1.96, 0.12, 0.06]} />
        <meshStandardMaterial map={trim} roughness={0.6} />
      </mesh>
      <OnWalls>
        <PaintedSign
          id={id}
          position={[0, 3.05, 0.17]}
          width={2.3}
          height={0.62}
          background={INK}
          border={color}
          icon={icon}
          iconColor={color}
          padding={0.14}
          lines={[
            { text: title, size: 0.34, color: "#fff6ea", weight: 900, tracking: 0.02 },
            { text: sub, size: 0.2, color, weight: 700, gap: 0.04 },
          ]}
        />
      </OnWalls>
    </group>
  );
}

/* ------------------------------------------------------------------ entrance */

function Entrance() {
  return (
    <group>
      {[-1, 1].map((side) => (
        <group key={side} position={[side * 1.05, 0, 10.5]} rotation={[0, side * 0.5, 0]}>
          <mesh position={[0, 1.3, 0]}>
            <boxGeometry args={[1.35, 2.5, 0.05]} />
            <meshStandardMaterial color="#cfe6f2" transparent opacity={0.22} roughness={0.05} metalness={0.3} />
          </mesh>
          {[-0.66, 0.66].map((x) => (
            <mesh key={x} position={[x, 1.3, 0]} castShadow>
              <boxGeometry args={[0.05, 2.5, 0.07]} />
              <meshStandardMaterial color="#3a3340" metalness={0.6} roughness={0.35} />
            </mesh>
          ))}
          <mesh position={[0, 1.2, 0.05]}>
            <boxGeometry args={[0.9, 0.04, 0.04]} />
            <meshStandardMaterial color="#c9c1cc" metalness={0.8} roughness={0.2} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 0.012, 9.4]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[2.8, 1.6]} />
        <meshStandardMaterial color="#4a3b52" roughness={1} />
      </mesh>

      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider position={[2.45, 0.4, 8.65]} args={[0.3, 0.4, 0.9]} />
        <Bench position={[2.45, 0, 8.65]} rotationY={-Math.PI / 2} />
      </RigidBody>
      <EvacuationStair position={[-1.1, 0, 7.35]} />
      <FloorMark position={[-1.1, 0, 9.3]} size={[0.34, 1.8]} color="#39ff88" opacity={0.85} />
      <PottedPlant position={[-2.55, 0, 10.05]} scale={0.9} />

      <OnWalls>
        <ExitSign position={[0, 2.9, 10.3]} rotationY={Math.PI} />
        <PaintedSign
          id="entry-welcome"
          position={[-2.83, 1.75, 8.7]}
          rotationY={Math.PI / 2}
          width={1.5}
          height={1.1}
          background="#fff6ea"
          border={INK}
          align="left"
          valign="top"
          padding={0.1}
          lines={[
            { text: "WELCOME", size: 0.15, color: CORAL, weight: 900, tracking: 0.01 },
            { text: "Science Block, Level 1", size: 0.1, color: INK, weight: 700, gap: 0.03 },
            { text: "In a drill: walk, don't run.", size: 0.085, color: "#5c5066", weight: 600, gap: 0.08 },
            { text: "Know two ways out.", size: 0.085, color: "#5c5066", weight: 600, gap: 0.02 },
          ]}
        />
      </OnWalls>
      <EvacueeOnly>
        <HangingSign
          id="west-stair"
          position={[-1.1, 3.05, 8.1]}
          width={2.1}
          height={0.44}
          drop={0.3}
          background="#128a4a"
          icon="running"
          iconColor="#f2fff6"
          padding={0.12}
          lines={[
            { text: "EMERGENCY STAIR", size: 0.42, color: "#f2fff6", weight: 900, tracking: 0.02 },
          ]}
        />
        <CeilingLight position={[0, 3.72, 8.8]} />
      </EvacueeOnly>
    </group>
  );
}

/* ------------------------------------------------------------------ corridor */

function Foyer() {
  return (
    <group>
      <RigidBody type="fixed" colliders="cuboid">
        <Reception position={[-2.6, 0, 5]} />
        <Sofa position={[3.9, 0, 4.2]} rotationY={-Math.PI / 2} />
        <mesh position={[0, 0.22, -1.2]} castShadow receiveShadow>
          <boxGeometry args={[1.6, 0.44, 1.6]} />
          <meshStandardMaterial map={wood("#8a5f3f", 1.6, 0.5)} roughness={0.7} />
        </mesh>
      </RigidBody>
      <Plant position={[0, 0.44, -1.2]} scale={1.25} />
      <PottedPlant position={[-4.8, 0, 6.2]} />
      <PottedPlant position={[4.8, 0, 6.2]} />
      <PottedPlant position={[-4.8, 0, -6.2]} />
      <PottedPlant position={[4.8, 0, -6.2]} />
      <RecycleBin position={[4.9, 0, -0.4]} />
      <Beakers position={[-2.9, 1.08, 4.9]} seed={1} />

      {/* green return route on the floor */}
      <FloorMark position={[0, 0, 3.6]} size={[0.3, 5.5]} color={MINT} opacity={0.5} />

      <Doorway
        id="door-science"
        position={[-5.62, 0, 2.5]}
        rotationY={Math.PI / 2}
        title="SCIENCE BLOCK"
        sub="Chemistry Lab 1A"
        color={MINT}
        icon="flask"
      />
      <Doorway
        id="door-academic"
        position={[5.62, 0, 2.5]}
        rotationY={-Math.PI / 2}
        title="ACADEMIC BLOCK"
        sub="Classroom A201"
        color={SUN}
      />

      <OnWalls>
        <BulletinBoard id="foyer-board" position={[5.33, 1.65, -3.2]} rotationY={-Math.PI / 2} />
        <FireAlarm position={[-5.33, 1.35, -0.4]} rotationY={Math.PI / 2} />
        <Poster
          id="foyer-poster"
          position={[-5.33, 1.8, -3.6]}
          rotationY={Math.PI / 2}
          width={1.2}
          height={1.6}
          background={VIOLET}
          align="left"
          valign="top"
          padding={0.1}
          lines={[
            { text: "IN A", size: 0.1, color: "#fff6ea", weight: 900 },
            { text: "DRILL", size: 0.16, color: SUN, weight: 900 },
            { text: "1. Stop and listen", size: 0.06, color: "#fff6ea", weight: 700, gap: 0.06 },
            { text: "2. Read the signs", size: 0.06, color: "#fff6ea", weight: 700, gap: 0.02 },
            { text: "3. Grab your kit", size: 0.06, color: "#fff6ea", weight: 700, gap: 0.02 },
            { text: "4. Walk to the exit", size: 0.06, color: "#fff6ea", weight: 700, gap: 0.02 },
          ]}
        />
      </OnWalls>
      {/* the north wall is cut away in the overhead views, so its signs belong to the evacuee */}
      <EvacueeOnly>
        {/* the north wall opens onto the Main Hall; trim and signs sit either side of it */}
        {[-1, 1].map((side) => (
          <WallTrim key={side} position={[side * 3.55, 0, -6.72]} width={3.5} accent={CORAL} />
        ))}
        <PaintedSign
          id="foyer-to-hall"
          position={[0, 3.4, -6.83]}
          width={3.2}
          height={0.5}
          background={INK}
          border={SUN}
          padding={0.1}
          lines={[{ text: "MAIN HALL  /  LIBRARY  /  CAFETERIA", size: 0.26, color: "#fff6ea", weight: 900, tracking: 0.02 }]}
        />
        <PaintedSign
          id="foyer-feature"
          position={[3.6, 2.05, -6.83]}
          width={2.9}
          height={1.6}
          background={INK}
          align="left"
          valign="top"
          padding={0.09}
          lines={[
            { text: "SCIENCE BLOCK / L1", size: 0.08, color: SUN, weight: 800, tracking: 0.01 },
            { text: "Central", size: 0.2, color: "#fff6ea", weight: 900, gap: 0.04 },
            { text: "Corridor", size: 0.2, color: "#fff6ea", weight: 900 },
            { text: "West door: Chemistry Lab 1A", size: 0.075, color: MINT, weight: 700, gap: 0.08 },
            { text: "East door: Classroom A201", size: 0.075, color: SUN, weight: 700, gap: 0.02 },
            { text: "North: Main Hall", size: 0.075, color: "#c9b8ff", weight: 700, gap: 0.02 },
            { text: "Exit: back through the south doors", size: 0.075, color: CORAL, weight: 700, gap: 0.02 },
          ]}
        />
        <ExitSign position={[0, 3.25, 6.85]} rotationY={Math.PI} scale={0.9} />
        <CeilingLight position={[0, 3.72, 4.2]} />
        <CeilingLight position={[0, 3.72, -0.6]} />
        <CeilingLight position={[0, 3.72, -5.2]} />
      </EvacueeOnly>
    </group>
  );
}

/* ------------------------------------------------------------- chemistry lab */

function GasManifold() {
  const pipe = "#c8b25a";
  return (
    <group>
      <mesh position={[-19.45, 1.9, -6.72]}>
        <cylinderGeometry args={[0.05, 0.05, 3.8, 10]} />
        <meshStandardMaterial color={pipe} metalness={0.6} roughness={0.35} />
      </mesh>
      <mesh position={[-19.45, 0.95, -5.5]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 2.45, 10]} />
        <meshStandardMaterial color={pipe} metalness={0.6} roughness={0.35} />
      </mesh>
      <mesh position={[-19.45, 1.02, -4.35]}>
        <cylinderGeometry args={[0.06, 0.06, 0.18, 10]} />
        <meshStandardMaterial color="#8a8190" metalness={0.7} roughness={0.3} />
      </mesh>
      <mesh position={[-19.45, 0.47, -4.35]}>
        <cylinderGeometry args={[0.05, 0.05, 0.95, 10]} />
        <meshStandardMaterial color={pipe} metalness={0.6} roughness={0.35} />
      </mesh>
      <mesh position={[-19.45, 0.03, -4.35]}>
        <cylinderGeometry args={[0.16, 0.16, 0.06, 14]} />
        <meshStandardMaterial color="#5a5260" metalness={0.5} roughness={0.4} />
      </mesh>
    </group>
  );
}

function ChemistryLab() {
  return (
    <group>
      <RigidBody type="fixed" colliders="cuboid">
        <Desk position={[-15, 0, -5.9]} size={[5.2, 0.75, 1.1]} />
        <Desk position={[-9.6, 0, 2.6]} size={[1.8, 0.72, 0.9]} rotationY={0.2} />
        <Locker position={[-21.5, 0, -5.2]} />
        <Locker position={[-21.5, 0, -3.9]} />
        <Shelf position={[-21.5, 0, 0.4]} />
        <Cabinet position={[-8.6, 0, -4.4]} rotationY={Math.PI} />
        <Cabinet position={[-8.6, 0, -3.5]} rotationY={Math.PI} />
        <GlassCabinet position={[-20.8, 0, -1.7]} />
        <GlassCabinet position={[-9.25, 0, -1.7]} rotationY={Math.PI} />
      </RigidBody>

      {/* the two lab islands carry explicit colliders so their glassware stays decorative */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider position={[-15, 0.48, -1.8]} args={[2.89, 0.48, 0.64]} />
        <CuboidCollider position={[-15, 0.48, 2.4]} args={[2.14, 0.48, 0.64]} />
        <CuboidCollider position={[-20.5, 0.45, 4.75]} args={[0.45, 0.45, 0.3]} />
      </RigidBody>
      <LabIsland position={[-15, 0, -1.8]} width={5.7} />
      <LabIsland position={[-15, 0, 2.4]} width={4.2} />
      <mesh position={[-13.7, 1.02, -1.8]} castShadow>
        <boxGeometry args={[0.52, 0.12, 0.38]} />
        <meshStandardMaterial color="#e6dfe8" roughness={0.6} />
      </mesh>
      <MicroscopeStation position={[-16.25, 0.07, -1.8]} />
      <MicroscopeStation position={[-15.2, 0.07, 2.4]} rotationY={0.15} />
      {[-17.2, -15.6, -14, -12.8].map((x, index) => (
        <Stool key={x} position={[x, 0, index % 2 ? -0.75 : -2.9]} />
      ))}
      {[-16.4, -14.9, -13.4].map((x) => (
        <Stool key={x} position={[x, 0, 3.45]} />
      ))}

      {/* back bench and fume hood */}
      <Beakers position={[-16.4, 0.76, -5.9]} seed={2} />
      <Beakers position={[-13.4, 0.76, -5.8]} seed={3} />
      <FumeHood position={[-11.25, 0, -5.85]} accent={CORAL} />

      {/* first-aid station */}
      <group position={[-20.5, 0, 4.75]}>
        <mesh position={[0, 0.87, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.9, 0.06, 0.6]} />
          <meshStandardMaterial color="#efe9f0" roughness={0.5} />
        </mesh>
        {[-0.4, 0.4].map((x) => (
          <mesh key={x} position={[x, 0.42, 0]}>
            <boxGeometry args={[0.05, 0.84, 0.5]} />
            <meshStandardMaterial color="#8a8190" metalness={0.5} roughness={0.4} />
          </mesh>
        ))}
      </group>

      <GasManifold />
      <ClimbableStack position={[-12.4, 0, 5.35]} color="#8a6a4a" height={2} />
      <PottedPlant position={[-8.9, 0, 5.9]} />
      <RecycleBin position={[-9, 0, -0.2]} color="#2f9c6a" />

      <OnWalls>
        <WallTrim position={[-15, 0, -6.72]} width={12.8} accent={MINT} />
        <SunsetWindow id="lab-west" position={[-21.84, 0, 2.9]} rotationY={Math.PI / 2} width={2.8} />
        <SunsetWindow id="lab-north" position={[-17.2, 0, -6.84]} width={2.2} height={1.2} sill={2.2} shaft={false} />
        <WritingBoard
          id="lab-board"
          position={[-14.2, 2.35, -6.83]}
          width={2.6}
          height={1.1}
          kind="marker"
          lines={[
            { text: "Science Builds", size: 0.16, color: "#3b4f7a" },
            { text: "Brighter Tomorrows", size: 0.16, color: "#c2412d" },
            { text: "Gas off before you leave!", size: 0.1, color: "#3b4f7a", gap: 0.08 },
          ]}
        />
        <BottleShelf position={[-11.25, 2.9, -6.7]} width={2.4} />
        <PaintedSign
          id="gas-shutoff"
          position={[-19.45, 2.05, -6.83]}
          width={1.2}
          height={0.72}
          background="#d8312f"
          icon="hazard"
          iconColor={SUN}
          padding={0.12}
          lines={[
            { text: "GAS", size: 0.3, color: "#fff6ea", weight: 900 },
            { text: "SHUT-OFF", size: 0.2, color: "#fff6ea", weight: 900 },
          ]}
        />
        <PaintedSign
          id="first-aid-sign"
          position={[-21.84, 1.85, 4.75]}
          rotationY={Math.PI / 2}
          width={0.9}
          height={0.62}
          background="#11a352"
          icon="cross"
          iconColor="#ffffff"
          padding={0.12}
          lines={[
            { text: "FIRST", size: 0.26, color: "#ffffff", weight: 900 },
            { text: "AID", size: 0.26, color: "#ffffff", weight: 900 },
          ]}
        />
        <Poster
          id="lab-rules"
          position={[-8.17, 1.85, 0.35]}
          rotationY={-Math.PI / 2}
          width={1.05}
          height={1.4}
          background="#fff6ea"
          align="left"
          valign="top"
          padding={0.08}
          lines={[
            { text: "LAB SAFETY", size: 0.1, color: CORAL, weight: 900 },
            { text: "Goggles on", size: 0.068, color: INK, weight: 700, gap: 0.06 },
            { text: "Know the gas valve", size: 0.068, color: INK, weight: 700, gap: 0.03 },
            { text: "First aid by window", size: 0.068, color: INK, weight: 700, gap: 0.03 },
            { text: "Exit: back door, then", size: 0.068, color: INK, weight: 700, gap: 0.03 },
            { text: "south to the foyer", size: 0.068, color: INK, weight: 700 },
          ]}
        />
        <PaintedSign
          id="lab-access"
          position={[-8.17, 1.75, 4.3]}
          rotationY={-Math.PI / 2}
          width={0.95}
          height={0.5}
          background={SUN}
          padding={0.1}
          lines={[
            { text: "LAB ACCESS", size: 0.3, color: INK, weight: 900 },
            { text: "sign in / card", size: 0.2, color: INK, weight: 600 },
          ]}
        />
        <ExitSign position={[-8.17, 2.72, 2.5]} rotationY={-Math.PI / 2} scale={0.8} />
        <FireAlarm position={[-8.17, 1.35, 5.6]} rotationY={-Math.PI / 2} />
        <WallClock position={[-21.78, 2.6, -1.7]} rotationY={Math.PI / 2} />
        <Speaker position={[-21.7, 3.2, -5.9]} rotationY={Math.PI / 2} />
      </OnWalls>
      <EvacueeOnly>
        <Banner
          id="lab-banner"
          position={[-15, 2.4, 6.8]}
          rotationY={Math.PI}
          width={3.6}
          height={0.8}
          background="#2f5fd0"
          lines={[
            { text: "CURIOSITY FUELS", size: 0.3, color: "#ffffff", weight: 900, tracking: 0.01 },
            { text: "A SAFER TOMORROW", size: 0.3, color: SUN, weight: 900, tracking: 0.01 },
          ]}
        />
        <HangingSign
          id="lab-name"
          position={[-10.6, 3.1, 0.3]}
          rotationY={Math.PI / 2}
          width={2}
          height={0.44}
          drop={0.25}
          background="#fff6ea"
          border={INK}
          icon="flask"
          iconColor={MINT}
          padding={0.12}
          lines={[{ text: "CHEMISTRY LAB 1A", size: 0.4, color: INK, weight: 900 }]}
        />
        <CeilingPipes position={[-15, 3.5, -4.4]} length={11.5} color="#8d8196" />
        {[-17.2, -12.8].flatMap((x) =>
          [-1.8, 2.4].map((z) => <PendantLight key={`${x}${z}`} position={[x, 3.2, z]} length={2.2} />),
        )}
      </EvacueeOnly>
      <Glow position={[-11.25, 1.45, -5.2]} color="#d8f6ff" size={1.8} opacity={0.2} />
    </group>
  );
}

/* ------------------------------------------------------------------ classroom */

const DESK_COLUMNS = [10.4, 12.2, 17.8, 19.6];
const DESK_ROWS = [1.25, -0.95, -3.15];

function Classroom() {
  return (
    <group>
      <RigidBody type="fixed" colliders="cuboid">
        <WoodCrate position={[20.7, 0.5, 4.3]} />
        <WoodCrate position={[20.7, 1.5, 4.3]} />
        <WoodCrate position={[19.5, 0.5, 4.9]} />
        <Desk position={[10.6, 0, 4.3]} size={[1.7, 0.75, 0.9]} />
        <Locker position={[21.4, 0, -4.4]} />
        <Locker position={[21.4, 0, -3.1]} />
        <Cabinet position={[8.6, 0, -4.4]} />
      </RigidBody>

      <RigidBody type="fixed" colliders={false}>
        {DESK_COLUMNS.flatMap((x) =>
          DESK_ROWS.map((z) => <CuboidCollider key={`${x}${z}`} position={[x, 0.39, z]} args={[0.6, 0.39, 0.3]} />),
        )}
      </RigidBody>
      {DESK_COLUMNS.flatMap((x, column) =>
        DESK_ROWS.map((z, row) => (
          <StudentDesk key={`${x}${z}`} position={[x, 0, z]} item={x === 12.2 && z === 1.25 ? 2 : column * 3 + row} />
        )),
      )}

      <ClassroomPodium position={[15, 0, 5.05]} rotationY={Math.PI} />
      <ClimbableStack position={[19.6, 0, 4.8]} color="#8a6a4a" height={2} />
      <PottedPlant position={[9, 0, 6.2]} />
      <PottedPlant position={[21.3, 0, 6.3]} scale={0.85} />
      <RecycleBin position={[8.7, 0, -5.8]} />

      <OnWalls>
        <WallTrim position={[15, 0, -6.72]} width={12.8} accent={SUN} />
        <SunsetWindow id="class-north-west" position={[10.8, 0, -6.84]} width={2.6} />
        <SunsetWindow id="class-north-east" position={[19.2, 0, -6.84]} width={2.6} />
        <SunsetWindow id="class-east" position={[21.84, 0, 0.2]} rotationY={-Math.PI / 2} width={3.2} />
        <PaintedSign
          id="service-door"
          position={[15, 3.32, -6.83]}
          width={1.9}
          height={0.4}
          background={INK}
          icon="hazard"
          iconColor={SUN}
          padding={0.12}
          lines={[{ text: "ELECTRICAL SERVICE", size: 0.4, color: "#fff6ea", weight: 900 }]}
        />
        <BulletinBoard id="class-board" position={[8.17, 1.65, -2.2]} rotationY={Math.PI / 2} />
        <ExitSign position={[8.17, 2.72, 2.5]} rotationY={Math.PI / 2} scale={0.8} />
        <WallClock position={[21.78, 2.45, -4.85]} rotationY={-Math.PI / 2} />
        <FireAlarm position={[8.17, 1.35, 5.6]} rotationY={Math.PI / 2} />
        <Speaker position={[21.7, 3.2, 5.4]} rotationY={-Math.PI / 2} />
      </OnWalls>
      <EvacueeOnly>
        <ProjectorScreen
          id="class-slide"
          position={[15, 2.2, 6.8]}
          rotationY={Math.PI}
          width={3.3}
          height={1.85}
          lines={[
            { text: "EVACUATION ROUTE", size: 0.1, color: "#5b4a9c", weight: 900 },
            { text: "Stay calm. Walk.", size: 0.13, color: INK, weight: 800, gap: 0.06 },
            { text: "1  Leave A201 by the west door", size: 0.068, color: "#3d3350", weight: 600, gap: 0.08 },
            { text: "2  Cross the central corridor", size: 0.068, color: "#3d3350", weight: 600, gap: 0.03 },
            { text: "3  Out through the south doors", size: 0.068, color: "#3d3350", weight: 600, gap: 0.03 },
            { text: "4  Wait at the assembly point", size: 0.068, color: "#3d3350", weight: 600, gap: 0.03 },
          ]}
        />
        <WritingBoard
          id="class-chalk-left"
          position={[11.3, 1.9, 6.83]}
          rotationY={Math.PI}
          width={2.7}
          height={1.2}
          lines={[
            { text: "Today: Fire safety", size: 0.14 },
            { text: "- 2 exits from every room", size: 0.1, gap: 0.06 },
            { text: "- never use the lift", size: 0.1, gap: 0.02 },
            { text: "- meet at the plaza", size: 0.1, gap: 0.02 },
          ]}
        />
        <WritingBoard
          id="class-chalk-right"
          position={[18.7, 1.9, 6.83]}
          rotationY={Math.PI}
          width={2.7}
          height={1.2}
          lines={[
            { text: "People, ideas,", size: 0.14, font: HAND_FONT },
            { text: "safer campuses.", size: 0.14, font: HAND_FONT, color: "#ffd98a" },
            { text: "Homework: map your route", size: 0.1, gap: 0.08 },
          ]}
        />
        <HangingSign
          id="class-name"
          position={[9.9, 3.1, 0.3]}
          rotationY={Math.PI / 2}
          width={1.9}
          height={0.44}
          drop={0.25}
          background="#fff6ea"
          border={INK}
          padding={0.12}
          lines={[{ text: "CLASSROOM A201", size: 0.4, color: INK, weight: 900 }]}
        />
        <Projector position={[15, 3.25, 1.2]} />
        {[12, 18].flatMap((x) => [-3, 1.5].map((z) => <CeilingLight key={`${x}${z}`} position={[x, 3.72, z]} />))}
      </EvacueeOnly>
    </group>
  );
}

export default function Rooms() {
  return (
    <>
      <Entrance />
      <Foyer />
      <ChemistryLab />
      <Classroom />
      <NorthWing />
    </>
  );
}
