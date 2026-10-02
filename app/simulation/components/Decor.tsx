"use client";

import * as THREE from "three";
import type { Vec3 } from "../level";
import { HAND_FONT, glowTexture, signTexture, sunsetView, wood, type SignOptions } from "../textures";

/**
 * Set dressing for the campus: painted signage, light halos, windows, furniture and exterior
 * props. Everything is primitive geometry with procedural textures, so it stays light to ship.
 */

type Placement = { position: Vec3; rotationY?: number };

const METAL = "#9a92a1";
const DARK_METAL = "#3a3340";

/* ------------------------------------------------------------------ light */

/** Additive halo sprite: a cheap stand-in for bloom around lamps, windows and signs. */
export function Glow({
  position,
  color = "#ffd9a8",
  size = 1.2,
  opacity = 0.5,
}: {
  position: Vec3;
  color?: string;
  size?: number;
  opacity?: number;
}) {
  return (
    <sprite position={position} scale={[size, size, 1]} renderOrder={5}>
      <spriteMaterial
        map={glowTexture()}
        color={color}
        transparent
        opacity={opacity}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </sprite>
  );
}

/** A long fluorescent fixture hanging on two wires. Only some fixtures carry a real light. */
/** A light panel's face, pushed past white so the bloom pass picks it up. */
export function hdr(color: string, boost = 2.6) {
  return new THREE.Color(color).multiplyScalar(boost);
}

export function PendantLight({
  position,
  rotationY = 0,
  length = 1.9,
  drop = 0.45,
  color = "#fff1dc",
  light = false,
  intensity = 5,
}: Placement & { length?: number; drop?: number; color?: string; light?: boolean; intensity?: number }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * length * 0.35, drop / 2, 0]}>
          <cylinderGeometry args={[0.006, 0.006, drop, 4]} />
          <meshBasicMaterial color="#2a2530" />
        </mesh>
      ))}
      <mesh>
        <boxGeometry args={[length, 0.08, 0.24]} />
        <meshStandardMaterial color="#e3dde6" roughness={0.45} metalness={0.25} />
      </mesh>
      <mesh position={[0, -0.045, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[length * 0.94, 0.17]} />
        <meshBasicMaterial color={hdr(color)} toneMapped={false} />
      </mesh>
      <Glow position={[0, -0.22, 0]} color={color} size={length * 1.25} opacity={0.3} />
      {light && <pointLight position={[0, -0.5, 0]} intensity={intensity} distance={12} decay={2} color={color} />}
    </group>
  );
}

/* ---------------------------------------------------------------- signage */

export interface PaintLine {
  text: string;
  /** Glyph height as a fraction of the sign height. */
  size: number;
  color?: string;
  weight?: number;
  font?: string;
  /** Space above the line as a fraction of the sign height. */
  gap?: number;
  /** Letter spacing as a fraction of the sign height. */
  tracking?: number;
}

export type SignContent = {
  lines: PaintLine[];
  background?: string | null;
  border?: string | null;
  align?: CanvasTextAlign;
  valign?: "top" | "center";
  icon?: SignOptions["icon"];
  iconColor?: string;
  /** Padding as a fraction of the sign height. */
  padding?: number;
  /** Unlit, self-illuminated (screens, exit signs, projected slides). */
  glow?: boolean;
  opacity?: number;
};

function canvasSize(width: number, height: number) {
  const aspect = width / height;
  return aspect >= 1
    ? { w: 1024, h: Math.max(64, Math.round(1024 / aspect)) }
    : { w: Math.max(64, Math.round(1024 * aspect)), h: 1024 };
}

/** Text painted onto a flat surface. `id` must be unique per distinct sign; textures are cached by it. */
export function PaintedSign({
  id,
  position,
  rotationY = 0,
  width,
  height,
  lines,
  background = null,
  border = null,
  align,
  valign,
  icon = null,
  iconColor,
  padding,
  glow = false,
  opacity = 1,
}: Placement & { id: string; width: number; height: number } & SignContent) {
  const { w, h } = canvasSize(width, height);
  const map = signTexture(id, {
    width: w,
    height: h,
    background,
    border,
    align,
    valign,
    icon,
    iconColor,
    padding: padding === undefined ? undefined : padding * h,
    lines: lines.map((line) => ({
      ...line,
      size: line.size * h,
      gap: (line.gap ?? 0) * h,
      tracking: (line.tracking ?? 0) * h,
    })),
  });
  const opaque = !!background && opacity >= 1;
  return (
    <mesh position={position} rotation={[0, rotationY, 0]} renderOrder={opaque ? 0 : 1}>
      <planeGeometry args={[width, height]} />
      {glow ? (
        <meshBasicMaterial map={map} transparent={!opaque} opacity={opacity} toneMapped={false} depthWrite={opaque} />
      ) : (
        <meshStandardMaterial
          map={map}
          transparent={!opaque}
          opacity={opacity}
          roughness={0.85}
          depthWrite={opaque}
          polygonOffset
          polygonOffsetFactor={-1}
        />
      )}
    </mesh>
  );
}

/** A framed print on a wall. */
export function Poster({
  id,
  position,
  rotationY = 0,
  width,
  height,
  frame = "#2b2233",
  ...content
}: Placement & { id: string; width: number; height: number; frame?: string } & SignContent) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh castShadow>
        <boxGeometry args={[width + 0.08, height + 0.08, 0.04]} />
        <meshStandardMaterial color={frame} roughness={0.6} />
      </mesh>
      <PaintedSign id={id} position={[0, 0, 0.022]} width={width} height={height} {...content} />
    </group>
  );
}

/** A cloth banner hanging between two rods. */
export function Banner({
  id,
  position,
  rotationY = 0,
  width = 1.1,
  height = 2.4,
  ...content
}: Placement & { id: string; width?: number; height?: number } & SignContent) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {[height / 2 + 0.05, -height / 2 - 0.04].map((y) => (
        <mesh key={y} position={[0, y, 0.01]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.022, 0.022, width + 0.18, 8]} />
          <meshStandardMaterial color={DARK_METAL} metalness={0.6} roughness={0.4} />
        </mesh>
      ))}
      <PaintedSign id={id} position={[0, 0, 0]} width={width} height={height} {...content} />
    </group>
  );
}

/** A street banner on its own pole. */
export function BannerPole({
  id,
  position,
  rotationY = 0,
  ...content
}: Placement & { id: string } & SignContent) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh position={[0, 2.6, 0]} castShadow>
        <cylinderGeometry args={[0.06, 0.08, 5.2, 10]} />
        <meshStandardMaterial color={DARK_METAL} metalness={0.5} roughness={0.45} />
      </mesh>
      <mesh position={[0.45, 4.35, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.025, 0.025, 0.9, 8]} />
        <meshStandardMaterial color={DARK_METAL} metalness={0.5} roughness={0.45} />
      </mesh>
      <Banner id={id} position={[0.62, 3.05, 0.02]} width={1.05} height={2.5} {...content} />
    </group>
  );
}

/** Green emergency exit sign with a running figure. */
export function ExitSign({ position, rotationY = 0, scale = 1 }: Placement & { scale?: number }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={scale}>
      <mesh>
        <boxGeometry args={[0.92, 0.36, 0.08]} />
        <meshStandardMaterial color="#21302a" roughness={0.5} />
      </mesh>
      <PaintedSign
        id="exit-sign"
        position={[0, 0, 0.045]}
        width={0.86}
        height={0.3}
        glow
        background="#11a352"
        icon="running"
        iconColor="#f2fff6"
        padding={0.12}
        lines={[{ text: "EXIT", size: 0.62, color: "#f2fff6", weight: 900, tracking: 0.03 }]}
      />
      <Glow position={[0, 0, 0.25]} color="#3dff8e" size={1.5} opacity={0.35} />
    </group>
  );
}

/** A sign board hung from the ceiling, readable from both sides. */
export function HangingSign({
  id,
  position,
  rotationY = 0,
  width = 3,
  height = 0.5,
  drop = 0.6,
  ...content
}: Placement & { id: string; width?: number; height?: number; drop?: number } & SignContent) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * width * 0.4, height / 2 + drop / 2, 0]}>
          <cylinderGeometry args={[0.006, 0.006, drop, 4]} />
          <meshBasicMaterial color="#2a2530" />
        </mesh>
      ))}
      <mesh>
        <boxGeometry args={[width + 0.06, height + 0.06, 0.05]} />
        <meshStandardMaterial color="#231c2b" roughness={0.6} />
      </mesh>
      <PaintedSign id={`${id}-front`} position={[0, 0, 0.03]} width={width} height={height} {...content} />
      <PaintedSign id={`${id}-front`} position={[0, 0, -0.03]} rotationY={Math.PI} width={width} height={height} {...content} />
    </group>
  );
}

/* ---------------------------------------------------------------- windows */

/** A tall window onto the sunset, with a soft light shaft falling into the room (+Z is inward). */
export function SunsetWindow({
  id,
  position,
  rotationY = 0,
  width = 3.4,
  height = 2.2,
  sill = 0.95,
  shaft = true,
}: Placement & { id: string; width?: number; height?: number; sill?: number; shaft?: boolean }) {
  const view = sunsetView(id, id.length * 7);
  const mid = sill + height / 2;
  const frame = "#efe6ee";
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh position={[0, mid, 0]}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial map={view} toneMapped={false} />
      </mesh>
      {[mid + height / 2, mid - height / 2].map((y) => (
        <mesh key={y} position={[0, y, 0.04]}>
          <boxGeometry args={[width + 0.16, 0.1, 0.1]} />
          <meshStandardMaterial color={frame} roughness={0.5} />
        </mesh>
      ))}
      {[-width / 2, -width / 6, width / 6, width / 2].map((x) => (
        <mesh key={x} position={[x, mid, 0.04]}>
          <boxGeometry args={[0.08, height, 0.08]} />
          <meshStandardMaterial color={frame} roughness={0.5} />
        </mesh>
      ))}
      <mesh position={[0, mid + height * 0.12, 0.04]}>
        <boxGeometry args={[width, 0.05, 0.06]} />
        <meshStandardMaterial color={frame} roughness={0.5} />
      </mesh>
      <mesh position={[0, sill - 0.04, 0.14]} castShadow>
        <boxGeometry args={[width + 0.3, 0.07, 0.3]} />
        <meshStandardMaterial color="#e2d7df" roughness={0.6} />
      </mesh>
      <Glow position={[0, mid, 0.35]} color="#ffb070" size={width * 1.5} opacity={0.32} />
      {shaft && (
        <>
          <mesh position={[0, sill + height * 0.25, 1.35]} rotation={[-0.95, 0, 0]}>
            <planeGeometry args={[width * 0.9, 3.4]} />
            <meshBasicMaterial
              color="#ffb27d"
              transparent
              opacity={0.07}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              side={THREE.DoubleSide}
              toneMapped={false}
            />
          </mesh>
          <mesh position={[0, -position[1] + 0.02, 2.2]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[width * 1.1, 2.6]} />
            <meshBasicMaterial
              map={glowTexture()}
              color="#ff9f62"
              transparent
              opacity={0.3}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              toneMapped={false}
            />
          </mesh>
        </>
      )}
    </group>
  );
}

/* -------------------------------------------------------------- laboratory */

const LIQUIDS = ["#5fc7ff", "#ff6fae", "#7ce3a1", "#ffc15a", "#b58cff"];

/** A small cluster of glassware with coloured liquids. */
export function Beakers({ position, seed = 0 }: { position: Vec3; seed?: number }) {
  return (
    <group position={position}>
      {[0, 1, 2, 3].map((index) => {
        const height = 0.12 + ((index + seed) % 3) * 0.06;
        const color = LIQUIDS[(index + seed) % LIQUIDS.length];
        return (
          <group key={index} position={[-0.2 + index * 0.13, 0, ((index + seed) % 2) * 0.06]}>
            <mesh position={[0, height / 2, 0]}>
              <cylinderGeometry args={[0.04, 0.045, height, 12]} />
              <meshStandardMaterial color="#eaf6ff" transparent opacity={0.32} roughness={0.05} />
            </mesh>
            <mesh position={[0, height * 0.28, 0]}>
              <cylinderGeometry args={[0.035, 0.04, height * 0.52, 12]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} transparent opacity={0.88} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/** White lab island: drawer cabinets, a black resin worktop and a reagent shelf. */
export function LabIsland({
  position,
  rotationY = 0,
  width = 3.2,
  depth = 1.2,
  shelf = true,
}: Placement & { width?: number; depth?: number; shelf?: boolean }) {
  const drawers = Math.max(2, Math.round(width / 0.8));
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh position={[0, 0.44, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, 0.88, depth]} />
        <meshStandardMaterial color="#efeaf0" roughness={0.55} />
      </mesh>
      {[-1, 1].flatMap((side) =>
        Array.from({ length: drawers }, (_, index) => {
          const x = -width / 2 + (width / drawers) * (index + 0.5);
          return (
            <group key={`${side}-${index}`} position={[x, 0.46, side * (depth / 2 + 0.006)]}>
              <mesh>
                <boxGeometry args={[width / drawers - 0.05, 0.012, 0.012]} />
                <meshStandardMaterial color="#bdb4c1" />
              </mesh>
              <mesh position={[-(width / drawers) / 2 + 0.03, 0, 0]}>
                <boxGeometry args={[0.012, 0.8, 0.012]} />
                <meshStandardMaterial color="#bdb4c1" />
              </mesh>
              <mesh position={[0, 0.2, 0]}>
                <boxGeometry args={[0.18, 0.025, 0.022]} />
                <meshStandardMaterial color={METAL} metalness={0.7} roughness={0.3} />
              </mesh>
            </group>
          );
        }),
      )}
      <mesh position={[0, 0.915, 0]} castShadow receiveShadow>
        <boxGeometry args={[width + 0.08, 0.07, depth + 0.08]} />
        <meshStandardMaterial color="#1f1b24" roughness={0.25} metalness={0.1} />
      </mesh>
      {shelf && (
        <group position={[0, 0.95, 0]}>
          {[-1, 1].map((side) => (
            <mesh key={side} position={[side * (width / 2 - 0.12), 0.42, 0]}>
              <boxGeometry args={[0.04, 0.84, 0.04]} />
              <meshStandardMaterial color={METAL} metalness={0.6} roughness={0.35} />
            </mesh>
          ))}
          <mesh position={[0, 0.6, 0]}>
            <boxGeometry args={[width - 0.14, 0.03, 0.3]} />
            <meshStandardMaterial color="#dcd5de" roughness={0.5} />
          </mesh>
          <Beakers position={[-width * 0.26, 0.615, 0]} />
          <Beakers position={[width * 0.2, 0.615, 0]} seed={2} />
          <Beakers position={[-width * 0.05, 0.01, 0.28]} seed={4} />
        </group>
      )}
    </group>
  );
}

/** Round lab stool on a chrome stem. */
export function Stool({ position }: { position: Vec3 }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.68, 0]} castShadow>
        <cylinderGeometry args={[0.2, 0.19, 0.07, 18]} />
        <meshStandardMaterial color="#2c2531" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.34, 0]}>
        <cylinderGeometry args={[0.025, 0.025, 0.64, 8]} />
        <meshStandardMaterial color={METAL} metalness={0.8} roughness={0.25} />
      </mesh>
      <mesh position={[0, 0.28, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.15, 0.012, 6, 18]} />
        <meshStandardMaterial color={METAL} metalness={0.8} roughness={0.25} />
      </mesh>
      <mesh position={[0, 0.016, 0]}>
        <cylinderGeometry args={[0.22, 0.24, 0.03, 18]} />
        <meshStandardMaterial color={DARK_METAL} metalness={0.5} roughness={0.4} />
      </mesh>
    </group>
  );
}

/** A wall-mounted reagent shelf with bottles. */
export function BottleShelf({ position, rotationY = 0, width = 2.2 }: Placement & { width?: number }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {[0, 0.55].map((y) => (
        <group key={y} position={[0, y, 0]}>
          <mesh castShadow>
            <boxGeometry args={[width, 0.04, 0.3]} />
            <meshStandardMaterial color="#e8e1ea" roughness={0.5} />
          </mesh>
          <Beakers position={[-width * 0.28, 0.02, 0]} seed={y > 0 ? 1 : 3} />
          <Beakers position={[width * 0.22, 0.02, 0]} seed={y > 0 ? 4 : 0} />
        </group>
      ))}
    </group>
  );
}

/** Red manual call point with a bell. */
export function FireAlarm({ position, rotationY = 0 }: Placement) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh castShadow>
        <boxGeometry args={[0.26, 0.34, 0.08]} />
        <meshStandardMaterial color="#d63a3f" roughness={0.45} />
      </mesh>
      <mesh position={[0, 0.02, 0.045]}>
        <boxGeometry args={[0.14, 0.12, 0.01]} />
        <meshStandardMaterial color="#f5efe9" roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.34, 0.02]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.1, 0.1, 0.06, 16]} />
        <meshStandardMaterial color="#c9302f" metalness={0.4} roughness={0.35} />
      </mesh>
    </group>
  );
}

/* --------------------------------------------------------------- classroom */

/** A student desk with a wooden top, steel frame and its chair behind it (students face +Z). */
export function StudentDesk({ position, rotationY = 0, item = 0 }: Placement & { item?: number }) {
  const top = wood("#b98552", 1, 0.5);
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh position={[0, 0.74, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.2, 0.05, 0.6]} />
        <meshStandardMaterial map={top} roughness={0.55} />
      </mesh>
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => (
          <mesh key={`${sx}${sz}`} position={[sx * 0.54, 0.36, sz * 0.24]}>
            <boxGeometry args={[0.04, 0.72, 0.04]} />
            <meshStandardMaterial color={DARK_METAL} metalness={0.5} roughness={0.4} />
          </mesh>
        )),
      )}
      <mesh position={[0, 0.58, 0]}>
        <boxGeometry args={[1.06, 0.025, 0.46]} />
        <meshStandardMaterial color="#4b4252" roughness={0.6} />
      </mesh>
      <group position={[0, 0, -0.62]}>
        <mesh position={[0, 0.46, 0]} castShadow>
          <boxGeometry args={[0.46, 0.05, 0.44]} />
          <meshStandardMaterial color="#2f2838" roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.74, -0.22]} castShadow>
          <boxGeometry args={[0.46, 0.4, 0.04]} />
          <meshStandardMaterial color="#2f2838" roughness={0.6} />
        </mesh>
        {[-1, 1].flatMap((sx) =>
          [-1, 1].map((sz) => (
            <mesh key={`c${sx}${sz}`} position={[sx * 0.2, 0.22, sz * 0.19]}>
              <boxGeometry args={[0.03, 0.45, 0.03]} />
              <meshStandardMaterial color={METAL} metalness={0.7} roughness={0.3} />
            </mesh>
          )),
        )}
      </group>
      {item % 3 === 0 && <Laptop position={[0.12, 0.765, 0.02]} rotationY={Math.PI} />}
      {item % 3 === 1 && <BookStack position={[-0.25, 0.765, 0.05]} seed={item} />}
      {item % 3 === 2 && (
        <mesh position={[0.35, 0.87, 0.12]} castShadow>
          <cylinderGeometry args={[0.04, 0.04, 0.2, 12]} />
          <meshStandardMaterial color="#3e5a4f" metalness={0.4} roughness={0.35} />
        </mesh>
      )}
    </group>
  );
}

/** An open laptop; the screen faces +Z. */
export function Laptop({ position, rotationY = 0 }: Placement) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh position={[0, 0.01, 0]} castShadow>
        <boxGeometry args={[0.36, 0.02, 0.25]} />
        <meshStandardMaterial color="#c9c3cd" metalness={0.5} roughness={0.35} />
      </mesh>
      <group position={[0, 0.02, -0.12]} rotation={[-0.25, 0, 0]}>
        <mesh position={[0, 0.12, 0]}>
          <boxGeometry args={[0.36, 0.24, 0.012]} />
          <meshStandardMaterial color="#c9c3cd" metalness={0.5} roughness={0.35} />
        </mesh>
        <mesh position={[0, 0.12, 0.007]}>
          <planeGeometry args={[0.32, 0.2]} />
          <meshBasicMaterial color="#6f5cff" toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

const BOOK_COLORS = ["#6b4fb0", "#d95f43", "#3f7d63", "#e0a83e", "#355c8a"];

export function BookStack({ position, seed = 0 }: { position: Vec3; seed?: number }) {
  return (
    <group position={position}>
      {[0, 1, 2].map((index) => (
        <mesh key={index} position={[0, 0.02 + index * 0.04, 0]} rotation={[0, (index - 1) * 0.18, 0]} castShadow>
          <boxGeometry args={[0.24, 0.035, 0.32]} />
          <meshStandardMaterial color={BOOK_COLORS[(index + seed) % BOOK_COLORS.length]} roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

/** A board with handwritten text: chalk on green, or marker on white. */
export function WritingBoard({
  id,
  position,
  rotationY = 0,
  width = 2.6,
  height = 1.3,
  kind = "chalk",
  lines,
}: Placement & { id: string; width?: number; height?: number; kind?: "chalk" | "marker"; lines: PaintLine[] }) {
  const chalk = kind === "chalk";
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh castShadow>
        <boxGeometry args={[width + 0.12, height + 0.12, 0.05]} />
        <meshStandardMaterial map={chalk ? wood("#8c6040", 2, 1) : undefined} color={chalk ? "#ffffff" : "#c9c2cc"} roughness={0.6} />
      </mesh>
      <PaintedSign
        id={id}
        position={[0, 0, 0.028]}
        width={width}
        height={height}
        background={chalk ? "#2f4b40" : "#f5f2ef"}
        align="left"
        valign="top"
        padding={0.08}
        lines={lines.map((line) => ({ font: HAND_FONT, weight: 600, color: chalk ? "#eef0e6" : "#3b4f7a", ...line }))}
      />
      <mesh position={[0, -height / 2 - 0.08, 0.06]}>
        <boxGeometry args={[width, 0.03, 0.08]} />
        <meshStandardMaterial color={chalk ? "#7b5638" : "#b3abb6"} roughness={0.6} />
      </mesh>
    </group>
  );
}

/** A pull-down projector screen showing a slide. */
export function ProjectorScreen({
  id,
  position,
  rotationY = 0,
  width = 3.2,
  height = 1.9,
  lines,
}: Placement & { id: string; width?: number; height?: number; lines: PaintLine[] }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh position={[0, height / 2 + 0.08, 0.02]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.07, 0.07, width + 0.3, 12]} />
        <meshStandardMaterial color="#2c2533" roughness={0.5} />
      </mesh>
      <PaintedSign
        id={id}
        position={[0, 0, 0.05]}
        width={width}
        height={height}
        glow
        background="#efeaf6"
        align="left"
        padding={0.1}
        icon="molecule"
        iconColor="#5b4a9c"
        lines={lines}
      />
      <Glow position={[0, 0, 0.3]} color="#d9ccff" size={width * 1.3} opacity={0.12} />
    </group>
  );
}

/** A ceiling-hung projector box. */
export function Projector({ position }: { position: Vec3 }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.25, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 0.5, 6]} />
        <meshStandardMaterial color={DARK_METAL} />
      </mesh>
      <mesh castShadow>
        <boxGeometry args={[0.5, 0.18, 0.42]} />
        <meshStandardMaterial color="#26212c" roughness={0.5} />
      </mesh>
      <mesh position={[0, 0, 0.22]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.06, 0.06, 0.04, 16]} />
        <meshBasicMaterial color="#cfe4ff" toneMapped={false} />
      </mesh>
    </group>
  );
}

/** A cork bulletin board with pinned notes. */
export function BulletinBoard({ id, position, rotationY = 0 }: Placement & { id: string }) {
  const notes: { x: number; y: number; color: string; text: string }[] = [
    { x: -0.45, y: 0.25, color: "#ffe28a", text: "Safety drill / Fri 4 PM" },
    { x: 0.35, y: 0.3, color: "#bfe8ff", text: "Project expo next week" },
    { x: -0.3, y: -0.25, color: "#ffc7d9", text: "Safer campuses, stronger people" },
    { x: 0.45, y: -0.22, color: "#c9f5d6", text: "Assembly point: plaza" },
  ];
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh castShadow>
        <boxGeometry args={[1.9, 1.3, 0.05]} />
        <meshStandardMaterial map={wood("#b88a5c", 2, 1.4)} roughness={0.85} />
      </mesh>
      {notes.map((note, index) => (
        <PaintedSign
          key={note.text}
          id={`${id}-note-${index}`}
          position={[note.x, note.y, 0.03 + index * 0.002]}
          rotationY={0}
          width={0.62}
          height={0.4}
          background={note.color}
          align="left"
          valign="top"
          padding={0.1}
          lines={[{ text: note.text, size: 0.16, color: "#3a2f45", font: HAND_FONT, weight: 600 }]}
        />
      ))}
    </group>
  );
}

/** A wall speaker. */
export function Speaker({ position, rotationY = 0 }: Placement) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh castShadow>
        <boxGeometry args={[0.3, 0.46, 0.24]} />
        <meshStandardMaterial color="#1f1a24" roughness={0.6} />
      </mesh>
      <mesh position={[0, -0.05, 0.125]}>
        <circleGeometry args={[0.1, 18]} />
        <meshStandardMaterial color="#3a3340" roughness={0.9} />
      </mesh>
    </group>
  );
}

/** Blue recycling bin. */
export function RecycleBin({ position, color = "#3f6fd6" }: { position: Vec3; color?: string }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.4, 0]} castShadow>
        <boxGeometry args={[0.46, 0.8, 0.46]} />
        <meshStandardMaterial color={color} roughness={0.55} />
      </mesh>
      <mesh position={[0, 0.82, 0]}>
        <boxGeometry args={[0.5, 0.05, 0.5]} />
        <meshStandardMaterial color="#2b4c96" roughness={0.5} />
      </mesh>
    </group>
  );
}

/* ---------------------------------------------------------------- nature */

/** A potted plant with layered leaves. */
export function PottedPlant({ position, scale = 1 }: { position: Vec3; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.22, 0]} castShadow>
        <cylinderGeometry args={[0.22, 0.17, 0.44, 16]} />
        <meshStandardMaterial color="#e7dfe6" roughness={0.6} />
      </mesh>
      {[0, 1, 2, 3, 4, 5].map((index) => {
        const angle = (index / 6) * Math.PI * 2;
        return (
          <mesh
            key={index}
            position={[Math.cos(angle) * 0.12, 0.72 + (index % 2) * 0.12, Math.sin(angle) * 0.12]}
            rotation={[Math.sin(angle) * 0.55, 0, -Math.cos(angle) * 0.55]}
            castShadow
          >
            <coneGeometry args={[0.12, 0.62, 5]} />
            <meshStandardMaterial color={index % 2 ? "#4f8a52" : "#3f7445"} roughness={0.8} flatShading />
          </mesh>
        );
      })}
    </group>
  );
}

/** A low-poly tree with a clustered canopy. */
export function Tree({ position, scale = 1, tint = "#4c7a4e" }: { position: Vec3; scale?: number; tint?: string }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 1.1, 0]} castShadow>
        <cylinderGeometry args={[0.13, 0.2, 2.2, 8]} />
        <meshStandardMaterial color="#5b4136" roughness={0.9} />
      </mesh>
      {(
        [
          [0, 2.9, 0, 1.25],
          [0.65, 3.45, 0.2, 0.9],
          [-0.55, 3.25, -0.3, 0.85],
          [0.1, 3.9, -0.2, 0.75],
        ] as const
      ).map(([x, y, z, r], index) => (
        <mesh key={index} position={[x, y, z]} castShadow>
          <icosahedronGeometry args={[r, 0]} />
          <meshStandardMaterial color={index % 2 ? tint : "#3f6844"} roughness={0.85} flatShading />
        </mesh>
      ))}
    </group>
  );
}

/** A slatted park bench. */
export function Bench({ position, rotationY = 0 }: Placement) {
  const slats = wood("#9b6b47", 1.6, 0.3);
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {[-0.14, 0, 0.14].map((z) => (
        <mesh key={z} position={[0, 0.46, z]} castShadow>
          <boxGeometry args={[1.8, 0.05, 0.12]} />
          <meshStandardMaterial map={slats} roughness={0.7} />
        </mesh>
      ))}
      {[0.62, 0.78].map((y) => (
        <mesh key={y} position={[0, y, -0.24]} castShadow>
          <boxGeometry args={[1.8, 0.1, 0.05]} />
          <meshStandardMaterial map={slats} roughness={0.7} />
        </mesh>
      ))}
      {[-0.75, 0.75].map((x) => (
        <mesh key={x} position={[x, 0.3, -0.04]} castShadow>
          <boxGeometry args={[0.07, 0.6, 0.5]} />
          <meshStandardMaterial color={DARK_METAL} metalness={0.5} roughness={0.45} />
        </mesh>
      ))}
    </group>
  );
}

/** A plaza lamp post with a warm lantern. */
export function LampPost({ position, light = false }: { position: Vec3; light?: boolean }) {
  return (
    <group position={position}>
      <mesh position={[0, 2.2, 0]} castShadow>
        <cylinderGeometry args={[0.07, 0.1, 4.4, 10]} />
        <meshStandardMaterial color={DARK_METAL} metalness={0.5} roughness={0.45} />
      </mesh>
      <mesh position={[0.4, 4.35, 0]}>
        <boxGeometry args={[0.9, 0.08, 0.1]} />
        <meshStandardMaterial color={DARK_METAL} metalness={0.5} roughness={0.45} />
      </mesh>
      <mesh position={[0.72, 4.22, 0]}>
        <boxGeometry args={[0.5, 0.14, 0.3]} />
        <meshStandardMaterial color="#2c2531" roughness={0.5} />
      </mesh>
      <mesh position={[0.72, 4.14, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.44, 0.24]} />
        <meshBasicMaterial color="#ffd49a" toneMapped={false} />
      </mesh>
      <Glow position={[0.72, 3.95, 0]} color="#ffc27d" size={2.2} opacity={0.45} />
      {light && <pointLight position={[0.72, 3.8, 0]} intensity={14} distance={14} decay={2} color="#ffc98f" />}
    </group>
  );
}
