"use client";

import { useMemo, useRef, type ReactNode, type RefObject } from "react";
import { useFrame, type ThreeElements } from "@react-three/fiber";
import { Outlines } from "@react-three/drei";
import * as THREE from "three";
import { clampDt } from "../runtime";
import type { EquipmentId } from "../level";

/**
 * The evacuee: a chibi university student built from primitives, drawn with toon shading and
 * ink outlines (no model files). Front faces +Z, feet rest at y = 0, about 2 units tall with hair.
 * The walk cycle follows how fast the figure actually moves, so the local player and the
 * warden's interpolated copy animate the same way.
 */

const COLORS = {
  skin: "#f3d8c2",
  hair: "#4b3226",
  eye: "#151215",
  mouth: "#3a2a26",
  hoodie: "#e8dfd2",
  string: "#7d7873",
  jacket: "#2e2c31",
  patch: "#ece6dc",
  pants: "#1f1f25",
  pantsPocket: "#29292f",
  shoe: "#f2eee6",
  sole: "#dcd5ca",
  shoeStripe: "#232228",
  pack: "#1d1c21",
  packPocket: "#26252b",
  strap: "#3d2b22",
  bottle: "#4d5c4a",
} as const;

const INK = "#120f0e";

let ramp: THREE.DataTexture | null = null;

/** Three-band light ramp shared by every toon material: shadow, mid, lit. */
function toonRamp() {
  if (!ramp) {
    ramp = new THREE.DataTexture(new Uint8Array([70, 160, 255]), 3, 1, THREE.RedFormat);
    ramp.minFilter = THREE.NearestFilter;
    ramp.magFilter = THREE.NearestFilter;
    ramp.generateMipmaps = false;
    ramp.needsUpdate = true;
  }
  return ramp;
}

type MeshProps = Omit<ThreeElements["mesh"], "children">;

/** A toon-shaded body part with an ink outline. */
function Part({
  color,
  ink = 0.018,
  doubleSided = false,
  children,
  ...mesh
}: MeshProps & { color: string; ink?: number; doubleSided?: boolean; children: ReactNode }) {
  return (
    <mesh castShadow {...mesh}>
      {children}
      <meshToonMaterial
        color={color}
        gradientMap={toonRamp()}
        emissive={color}
        emissiveIntensity={0.16}
        side={doubleSided ? THREE.DoubleSide : THREE.FrontSide}
      />
      {ink > 0 && <Outlines thickness={ink} color={INK} />}
    </mesh>
  );
}

/** Flat, unlit detail (eyes, mouth, stripes) so the face reads in any lighting. */
function Detail({ color, children, ...mesh }: MeshProps & { color: string; children: ReactNode }) {
  return (
    <mesh {...mesh}>
      {children}
      <meshBasicMaterial color={color} />
    </mesh>
  );
}

type Vec3 = [number, number, number];

const UP = new THREE.Vector3(0, 1, 0);

/** A cone-shaped hair clump rooted at `anchor`, pointing along `outward`. */
function clump(anchor: Vec3, outward: Vec3, length: number, radius: number) {
  const dir = new THREE.Vector3(...outward).normalize();
  const euler = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir));
  const center = new THREE.Vector3(...anchor).addScaledVector(dir, length * 0.45);
  return {
    position: center.toArray() as Vec3,
    rotation: [euler.x, euler.y, euler.z] as Vec3,
    length,
    radius,
  };
}

/** Messy anime hair: crown spikes, a swept back, side locks and short bangs above the eyes. */
const HAIR = [
  clump([0, 0.3, -0.08], [0.15, 1, -0.25], 0.24, 0.09),
  clump([0.13, 0.27, -0.02], [0.75, 1, 0.1], 0.22, 0.085),
  clump([-0.13, 0.27, -0.02], [-0.75, 1, 0.1], 0.22, 0.085),
  clump([0.08, 0.24, -0.2], [0.5, 0.8, -0.8], 0.22, 0.085),
  clump([-0.1, 0.23, -0.2], [-0.6, 0.8, -0.8], 0.22, 0.085),
  clump([0, 0.13, -0.3], [0, 0.25, -1], 0.2, 0.09),
  clump([0.21, 0.11, -0.2], [0.85, 0.2, -0.6], 0.18, 0.08),
  clump([-0.21, 0.11, -0.2], [-0.85, 0.2, -0.6], 0.18, 0.08),
  clump([0.27, 0.03, 0.02], [0.6, -1, 0.1], 0.18, 0.07),
  clump([-0.27, 0.03, 0.02], [-0.6, -1, 0.1], 0.18, 0.07),
  clump([-0.15, 0.17, 0.2], [-0.35, -1, 0.35], 0.12, 0.07),
  clump([-0.05, 0.18, 0.23], [-0.1, -1, 0.3], 0.13, 0.075),
  clump([0.06, 0.18, 0.23], [0.15, -1, 0.3], 0.12, 0.07),
  clump([0.16, 0.16, 0.19], [0.45, -1, 0.3], 0.11, 0.065),
  clump([-0.12, 0.18, 0.2], [-0.35, -0.8, 0.72], 0.15, 0.06),
  clump([0.02, 0.2, 0.24], [0.05, -0.95, 0.55], 0.16, 0.065),
  clump([0.14, 0.18, 0.2], [0.38, -0.8, 0.7], 0.14, 0.06),
];

function Head() {
  return (
    <group position={[0, 1.72, 0]}>
      <Part color={COLORS.skin} ink={0.022} scale={[1, 0.94, 0.92]}>
        <sphereGeometry args={[0.27, 28, 20]} />
      </Part>
      {[1, -1].map((side) => (
        <Detail key={side} color={COLORS.eye} position={[0.095 * side, -0.01, 0.244]} scale={[0.75, 1.3, 0.35]}>
          <sphereGeometry args={[0.04, 16, 12]} />
        </Detail>
      ))}
      {[1, -1].map((side) => (
        <Detail
          key={`brow-${side}`}
          color={COLORS.mouth}
          position={[0.095 * side, 0.075, 0.247]}
          rotation={[0, 0, side * -0.12]}
        >
          <boxGeometry args={[0.065, 0.012, 0.01]} />
        </Detail>
      ))}
      <Detail color={COLORS.mouth} position={[0, -0.115, 0.229]}>
        <boxGeometry args={[0.05, 0.009, 0.01]} />
      </Detail>
      <Part
        color={COLORS.hair}
        ink={0.02}
        position={[0, 0.06, -0.02]}
        rotation={[-0.4, 0, 0]}
        scale={[1.05, 0.95, 1.05]}
        doubleSided
      >
        <sphereGeometry args={[0.3, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
      </Part>
      {HAIR.map((hair, index) => (
        <Part key={index} color={COLORS.hair} ink={0.014} position={hair.position} rotation={hair.rotation}>
          <coneGeometry args={[hair.radius, hair.length, 6]} />
        </Part>
      ))}
    </group>
  );
}

function Torso() {
  return (
    <>
      <Part color={COLORS.jacket} position={[0, 1.1, 0]} scale={[1.08, 1, 0.72]}>
        <capsuleGeometry args={[0.2, 0.3, 6, 14]} />
      </Part>
      <Part color={COLORS.hoodie} ink={0.008} position={[0, 1.1, 0.145]}>
        <boxGeometry args={[0.17, 0.44, 0.02]} />
      </Part>
      <Part color={COLORS.hoodie} ink={0.014} position={[0, 1.44, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.12, 0.05, 8, 18]} />
      </Part>
      <Part color={COLORS.hoodie} ink={0.016} position={[0, 1.4, -0.13]} scale={[1.25, 0.6, 0.8]}>
        <sphereGeometry args={[0.16, 16, 12]} />
      </Part>
      {[1, -1].map((side) => (
        <Detail key={side} color={COLORS.string} position={[0.045 * side, 1.31, 0.158]}>
          <cylinderGeometry args={[0.009, 0.009, 0.17, 6]} />
        </Detail>
      ))}
      <Part color={COLORS.skin} ink={0} position={[0, 1.5, 0]}>
        <cylinderGeometry args={[0.055, 0.06, 0.12, 12]} />
      </Part>
    </>
  );
}

function HeldItem({ type }: { type: EquipmentId }) {
  return type === "access-card" ? (
    <group rotation={[0.15, 0.2, -0.2]}>
      <mesh castShadow>
        <boxGeometry args={[0.12, 0.2, 0.025]} />
        <meshStandardMaterial color="#facc15" emissive="#8a6400" emissiveIntensity={0.35} />
      </mesh>
      <mesh position={[0, 0.02, 0.015]}>
        <boxGeometry args={[0.07, 0.025, 0.01]} />
        <meshBasicMaterial color="#f8fafc" />
      </mesh>
    </group>
  ) : (
    <group rotation={[0.1, 0.1, -0.15]}>
      <mesh castShadow>
        <boxGeometry args={[0.16, 0.22, 0.04]} />
        <meshStandardMaterial color="#a78bfa" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.04, 0.025]}>
        <boxGeometry args={[0.1, 0.012, 0.01]} />
        <meshBasicMaterial color="#f5f3ff" />
      </mesh>
    </group>
  );
}

function Arm({
  side,
  swing,
  heldItem,
}: {
  side: 1 | -1;
  swing: RefObject<THREE.Group | null>;
  heldItem: EquipmentId | null;
}) {
  return (
    <group position={[0.28 * side, 1.38, 0]} rotation={[0, 0, 0.12 * side]}>
      <group ref={swing}>
        <Part color={COLORS.jacket} position={[0, -0.24, 0]}>
          <capsuleGeometry args={[0.078, 0.32, 4, 10]} />
        </Part>
        <Part color={COLORS.skin} ink={0.014} position={[0, -0.52, 0.01]}>
          <sphereGeometry args={[0.068, 14, 12]} />
        </Part>
        {side === 1 && heldItem && <group position={[0, -0.56, 0.1]}><HeldItem type={heldItem} /></group>}
        {side === 1 && (
          <Detail color={COLORS.patch} position={[0.078, -0.12, 0]} rotation={[0, Math.PI / 2, 0]}>
            <boxGeometry args={[0.1, 0.06, 0.012]} />
          </Detail>
        )}
      </group>
    </group>
  );
}

function Leg({ side, swing }: { side: 1 | -1; swing: RefObject<THREE.Group | null> }) {
  return (
    <group ref={swing} position={[0.11 * side, 0.8, 0]}>
      <Part color={COLORS.pants} position={[0, -0.36, 0]}>
        <capsuleGeometry args={[0.085, 0.5, 4, 10]} />
      </Part>
      <Part color={COLORS.pantsPocket} ink={0.01} position={[0.085 * side, -0.36, 0.01]}>
        <boxGeometry args={[0.05, 0.13, 0.14]} />
      </Part>
      <Part color={COLORS.shoe} position={[0, -0.735, 0.045]}>
        <boxGeometry args={[0.15, 0.13, 0.3]} />
      </Part>
      <Part color={COLORS.sole} ink={0.01} position={[0, -0.785, 0.045]}>
        <boxGeometry args={[0.165, 0.035, 0.315]} />
      </Part>
      <Detail color={COLORS.shoeStripe} position={[0.077 * side, -0.73, 0.03]}>
        <boxGeometry args={[0.01, 0.07, 0.16]} />
      </Detail>
    </group>
  );
}

function Backpack() {
  return (
    <group position={[0, 1.12, -0.2]}>
      <Part color={COLORS.pack}>
        <boxGeometry args={[0.36, 0.44, 0.18]} />
      </Part>
      <Part color={COLORS.packPocket} ink={0.012} position={[0, -0.1, -0.105]}>
        <boxGeometry args={[0.26, 0.16, 0.05]} />
      </Part>
      <Part color={COLORS.pack} ink={0.01} position={[0, 0.24, 0]}>
        <torusGeometry args={[0.055, 0.016, 6, 14]} />
      </Part>
      <Part color={COLORS.bottle} ink={0.012} position={[0.21, -0.06, 0]}>
        <cylinderGeometry args={[0.045, 0.045, 0.2, 10]} />
      </Part>
      {[1, -1].map((side) => (
        <group key={side}>
          <Part color={COLORS.strap} ink={0.008} position={[0.12 * side, 0.06, 0.355]}>
            <boxGeometry args={[0.055, 0.46, 0.025]} />
          </Part>
          <Part color={COLORS.strap} ink={0.008} position={[0.12 * side, 0.31, 0.18]}>
            <boxGeometry args={[0.055, 0.025, 0.38]} />
          </Part>
        </group>
      ))}
    </group>
  );
}

export default function Student({
  hasBackpack = true,
  heldItem = null,
}: {
  hasBackpack?: boolean;
  heldItem?: EquipmentId | null;
}) {
  const root = useRef<THREE.Group>(null);
  const upper = useRef<THREE.Group>(null);
  const legLeft = useRef<THREE.Group>(null);
  const legRight = useRef<THREE.Group>(null);
  const armLeft = useRef<THREE.Group>(null);
  const armRight = useRef<THREE.Group>(null);
  const motion = useRef({ phase: 0, speed: 0, time: 0, last: null as THREE.Vector3 | null });
  const worldPosition = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, rawDt) => {
    const group = root.current;
    if (!group) return;
    const dt = clampDt(rawDt);
    const state = motion.current;

    group.getWorldPosition(worldPosition);
    const planarSpeed =
      state.last && dt > 0
        ? Math.hypot(worldPosition.x - state.last.x, worldPosition.z - state.last.z) / dt
        : 0;
    if (state.last) state.last.copy(worldPosition);
    else state.last = worldPosition.clone();

    state.time += dt;
    state.speed += (Math.min(planarSpeed, 8) - state.speed) * Math.min(1, dt * 10);
    const stride = Math.min(1, state.speed / 4);
    state.phase += dt * (3 + state.speed * 1.8);

    const swing = Math.sin(state.phase) * 0.7 * stride;
    if (legLeft.current) legLeft.current.rotation.x = swing;
    if (legRight.current) legRight.current.rotation.x = -swing;
    if (armLeft.current) armLeft.current.rotation.x = -swing * 0.85;
    if (armRight.current) armRight.current.rotation.x = swing * 0.85;
    if (upper.current)
      upper.current.position.y =
        Math.abs(Math.sin(state.phase)) * 0.035 * stride + Math.sin(state.time * 2.2) * 0.008 * (1 - stride);
  });

  return (
    <group ref={root}>
      <Leg side={1} swing={legLeft} />
      <Leg side={-1} swing={legRight} />
      <Part color={COLORS.pants} position={[0, 0.84, 0]}>
        <boxGeometry args={[0.36, 0.18, 0.22]} />
      </Part>
      <group ref={upper}>
        <Torso />
        <Arm side={1} swing={armLeft} heldItem={heldItem} />
        <Arm side={-1} swing={armRight} heldItem={null} />
        {hasBackpack && <Backpack />}
        <Head />
      </group>
    </group>
  );
}
