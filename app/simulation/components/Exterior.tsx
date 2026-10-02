"use client";

import { useMemo } from "react";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import * as THREE from "three";
import { ASSEMBLY_Z, SUN_DIRECTION } from "../level";
import { useSimulation } from "../store";
import { paving, plaster, windowGrid } from "../textures";
import { BannerPole, Bench, Glow, LampPost, PaintedSign, Tree } from "./Decor";
import { Label } from "./Markers";

const SUN = new THREE.Vector3(...SUN_DIRECTION).normalize();

/** Sunset gradient dome with a soft sun disc. */
function Sky() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        toneMapped: false,
        uniforms: {
          zenith: { value: new THREE.Color("#2b2154") },
          mid: { value: new THREE.Color("#a3467c") },
          horizon: { value: new THREE.Color("#ff8c5c") },
          ground: { value: new THREE.Color("#2a2030") },
          sunColor: { value: new THREE.Color("#ffd2a0") },
          sunDir: { value: SUN.clone() },
        },
        vertexShader: `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 zenith;
          uniform vec3 mid;
          uniform vec3 horizon;
          uniform vec3 ground;
          uniform vec3 sunColor;
          uniform vec3 sunDir;
          varying vec3 vDir;
          void main() {
            vec3 dir = normalize(vDir);
            float h = dir.y;
            vec3 color = mix(horizon, mid, smoothstep(0.0, 0.22, h));
            color = mix(color, zenith, smoothstep(0.2, 0.72, h));
            float s = max(dot(dir, normalize(sunDir)), 0.0);
            color += sunColor * (smoothstep(0.9965, 0.998, s) * 1.4 + pow(s, 28.0) * 0.5 + pow(s, 5.0) * 0.14);
            color = mix(color, ground, smoothstep(0.0, -0.12, h));
            gl_FragColor = vec4(color, 1.0);
            #include <colorspace_fragment>
          }
        `,
      }),
    [],
  );

  return (
    <mesh material={material}>
      <sphereGeometry args={[150, 48, 24]} />
    </mesh>
  );
}

/** Flat, soft cloud banks low on the horizon. */
function Clouds() {
  const clouds = useMemo(() => {
    const out: { position: [number, number, number]; scale: number; tint: string }[] = [];
    for (let i = 0; i < 9; i++) {
      const angle = -Math.PI * 0.95 + i * 0.36;
      out.push({
        position: [Math.cos(angle) * 110, 20 + ((i * 7) % 5) * 5, Math.sin(angle) * 110],
        scale: 6 + ((i * 5) % 4) * 2,
        tint: i % 2 ? "#e98aa4" : "#c8709c",
      });
    }
    return out;
  }, []);
  return (
    <group>
      {clouds.map((cloud, index) => (
        <group key={index} position={cloud.position} scale={cloud.scale}>
          {[
            [0, 0, 0, 1.4],
            [1.3, 0.2, 0.2, 1],
            [-1.2, 0.1, -0.1, 1.1],
          ].map(([x, y, z, r], part) => (
            <mesh key={part} position={[x, y, z]} scale={[1.6, 0.42, 1]}>
              <sphereGeometry args={[r, 14, 8]} />
              <meshBasicMaterial color={cloud.tint} fog={false} toneMapped={false} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

/** Distant city blocks, softened by fog. */
function Skyline() {
  const blocks = useMemo(() => {
    const out: { pos: [number, number, number]; size: [number, number, number] }[] = [];
    let seed = 7;
    const rnd = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      const r = 58 + rnd() * 24;
      const h = 10 + rnd() * 30;
      const w = 7 + rnd() * 9;
      out.push({ pos: [Math.cos(a) * r, h / 2, Math.sin(a) * r], size: [w, h, w] });
    }
    return out;
  }, []);
  return (
    <group>
      {blocks.map((b, i) => (
        <mesh key={i} position={b.pos}>
          <boxGeometry args={b.size} />
          <meshStandardMaterial color="#4f3d5f" emissive="#2a1b36" emissiveIntensity={0.6} roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

/** A lit ground-floor window seen from the plaza. */
function FacadeWindow({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh>
        <boxGeometry args={[2.5, 1.8, 0.08]} />
        <meshStandardMaterial color="#8e7f92" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0, 0.05]}>
        <planeGeometry args={[2.3, 1.6]} />
        <meshBasicMaterial color="#ffc98a" toneMapped={false} />
      </mesh>
      <mesh position={[0, 0, 0.07]}>
        <boxGeometry args={[0.06, 1.6, 0.04]} />
        <meshStandardMaterial color="#8e7f92" />
      </mesh>
      <Glow position={[0, 0, 0.4]} color="#ffb070" size={3} opacity={0.25} />
    </group>
  );
}

/** Upper storeys, signage and lit windows. Hidden in the overhead views so they never block the drill. */
function Facade() {
  const concrete = plaster("#bdaebd", 20, 6);
  const leftWindows = windowGrid("upper-left", 12, 3, 3);
  const rightWindows = windowGrid("upper-right", 12, 3, 9);
  const tower = windowGrid("tower", 4, 5, 5);
  return (
    <group>
      <mesh position={[0, 4.35, 7.05]}>
        <boxGeometry args={[44.6, 0.5, 0.35]} />
        <meshStandardMaterial map={concrete} roughness={0.9} />
      </mesh>
      {[-1, 1].map((side) => (
        <group key={side}>
          <mesh position={[side * 12.9, 7.05, -1.2]} castShadow>
            <boxGeometry args={[18.4, 5.9, 11.6]} />
            <meshStandardMaterial map={concrete} roughness={0.9} />
          </mesh>
          <mesh position={[side * 12.9, 7.05, 4.62]}>
            <planeGeometry args={[18.2, 5.6]} />
            <meshStandardMaterial
              map={side < 0 ? leftWindows : rightWindows}
              emissiveMap={side < 0 ? leftWindows : rightWindows}
              emissive="#ffffff"
              emissiveIntensity={0.42}
              roughness={0.6}
            />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 8.2, 0.8]} castShadow>
        <boxGeometry args={[7, 8.2, 7.6]} />
        <meshStandardMaterial map={concrete} roughness={0.9} />
      </mesh>
      <mesh position={[0, 8.3, 4.62]}>
        <planeGeometry args={[6.6, 7.6]} />
        <meshStandardMaterial map={tower} emissiveMap={tower} emissive="#ffffff" emissiveIntensity={0.5} roughness={0.35} />
      </mesh>

      {[-19.4, -16.4, -8.8, -5.8].map((x) => (
        <FacadeWindow key={x} position={[x, 1.9, 7.2]} />
      ))}
      {[5.8, 8.8, 16.4, 19.4].map((x) => (
        <FacadeWindow key={x} position={[x, 1.9, 7.2]} />
      ))}

      <PaintedSign
        id="facade-science"
        position={[-12.6, 2.05, 7.2]}
        width={4.6}
        height={2.9}
        align="left"
        lines={[
          { text: "SCIENCE", size: 0.22, color: "#3e2f4c", weight: 800, tracking: 0.01 },
          { text: "BLOCK", size: 0.22, color: "#3e2f4c", weight: 800, tracking: 0.01 },
          { text: "EXPLORE / DISCOVER", size: 0.085, color: "#5f4d6c", weight: 600, gap: 0.08, tracking: 0.01 },
          { text: "BUILD A SAFER TOMORROW", size: 0.085, color: "#5f4d6c", weight: 600, tracking: 0.01 },
        ]}
      />
      <PaintedSign
        id="facade-academic"
        position={[12.6, 2.05, 7.2]}
        width={4.6}
        height={2.9}
        align="left"
        lines={[
          { text: "ACADEMIC", size: 0.22, color: "#3e2f4c", weight: 800, tracking: 0.01 },
          { text: "BLOCK", size: 0.22, color: "#3e2f4c", weight: 800, tracking: 0.01 },
          { text: "LEARN / PREPARE", size: 0.085, color: "#5f4d6c", weight: 600, gap: 0.08, tracking: 0.01 },
          { text: "PEOPLE, IDEAS, SAFER CAMPUSES", size: 0.085, color: "#5f4d6c", weight: 600, tracking: 0.01 },
        ]}
      />
    </group>
  );
}

/** The ring-and-cube plaza sculpture. */
function Sculpture({ position }: { position: [number, number, number] }) {
  return (
    <RigidBody type="fixed" colliders={false} position={position}>
      <CuboidCollider args={[0.9, 0.4, 0.9]} position={[0, 0.4, 0]} />
      <mesh position={[0, 0.4, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.8, 0.8, 1.8]} />
        <meshStandardMaterial map={plaster("#b3a4b3", 2, 1)} roughness={0.85} />
      </mesh>
      <mesh position={[0, 2.1, 0]} rotation={[0, 0.5, 0]} castShadow>
        <torusGeometry args={[1.05, 0.06, 10, 40]} />
        <meshStandardMaterial color="#6a5a73" metalness={0.7} roughness={0.3} />
      </mesh>
      <mesh position={[0, 2.1, 0]} rotation={[0.6, 0.7, 0.3]} castShadow>
        <boxGeometry args={[0.95, 0.95, 0.95]} />
        <meshStandardMaterial color="#7b6b85" metalness={0.35} roughness={0.45} />
      </mesh>
    </RigidBody>
  );
}

/** The assembly point: a ring on the paving and a sign post. The warden also gets a label. */
function AssemblyPoint() {
  const view = useSimulation((s) => s.view);
  return (
    <group position={[0, 0, ASSEMBLY_Z + 2]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[1.5, 1.8, 48]} />
        <meshBasicMaterial color="#39ff88" transparent opacity={0.55} toneMapped={false} />
      </mesh>
      <group position={[2.4, 0, 0.2]}>
        <mesh position={[0, 1.1, 0]} castShadow>
          <cylinderGeometry args={[0.045, 0.045, 2.2, 8]} />
          <meshStandardMaterial color="#3a3340" metalness={0.5} roughness={0.45} />
        </mesh>
        <PaintedSign
          id="assembly-point"
          position={[0, 2.1, 0.05]}
          width={1.3}
          height={0.62}
          background="#159a52"
          icon="running"
          iconColor="#f2fff6"
          padding={0.12}
          lines={[
            { text: "ASSEMBLY", size: 0.3, color: "#f2fff6", weight: 900 },
            { text: "POINT", size: 0.3, color: "#f2fff6", weight: 900 },
          ]}
        />
      </group>
      {view !== "evacuee" && <Label position={[0, 1.2, 0]} color="#10b981" text="Assembly point" />}
    </group>
  );
}

export default function Exterior() {
  const evacueeView = useSimulation((s) => s.view === "evacuee");
  const plaza = paving(26, 15);
  const apron = paving(8, 3);

  return (
    <>
      <Sky />
      <Clouds />

      {/* ground + an invisible perimeter so nobody walks into the void */}
      <RigidBody type="fixed" colliders={false}>
        <mesh position={[0, -0.14, 6]} receiveShadow>
          <boxGeometry args={[220, 0.24, 220]} />
          <meshStandardMaterial color="#3f3448" roughness={1} />
        </mesh>
        <CuboidCollider position={[0, -0.25, 6]} args={[110, 0.25, 110]} />
        <CuboidCollider position={[0, 3, 30]} args={[40, 4, 0.5]} />
        <CuboidCollider position={[0, 3, -32]} args={[40, 4, 0.5]} />
        <CuboidCollider position={[-32, 3, 0]} args={[0.5, 4, 40]} />
        <CuboidCollider position={[32, 3, 0]} args={[0.5, 4, 40]} />
      </RigidBody>

      {/* plaza paving and lawns */}
      <mesh position={[0, 0.02, 17.5]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[26, 15]} />
        <meshStandardMaterial map={plaza} roughness={0.42} metalness={0.05} />
      </mesh>
      <mesh position={[0, 0.03, 11.9]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[8, 3]} />
        <meshStandardMaterial map={apron} roughness={0.42} metalness={0.05} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 19, 0.015, 17.5]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[12, 15]} />
          <meshStandardMaterial color="#4a5c47" roughness={1} />
        </mesh>
      ))}

      {/* entrance canopy and header sign */}
      <group visible={evacueeView}>
        <mesh position={[0, 3.5, 11.6]} castShadow>
          <boxGeometry args={[7.4, 0.25, 2.6]} />
          <meshStandardMaterial map={plaster("#9d8ea0", 7, 2.6)} roughness={0.8} />
        </mesh>
        {[-3.4, 3.4].map((x) => (
          <mesh key={x} position={[x, 1.75, 12.7]} castShadow>
            <boxGeometry args={[0.22, 3.5, 0.22]} />
            <meshStandardMaterial color="#6d5f73" roughness={0.6} />
          </mesh>
        ))}
        <Glow position={[0, 3.1, 11.6]} color="#ffd6a0" size={3.5} opacity={0.28} />
      </group>
      <mesh position={[0, 4.3, 10.4]}>
        <boxGeometry args={[4.8, 0.8, 0.15]} />
        <meshStandardMaterial color="#2b2140" roughness={0.6} />
      </mesh>
      <PaintedSign
        id="main-entrance"
        position={[0, 4.3, 10.49]}
        width={4.6}
        height={0.7}
        glow
        background="#2b2140"
        lines={[
          { text: "MAIN ENTRANCE", size: 0.46, color: "#ffc44d", weight: 900, tracking: 0.03 },
          { text: "SCIENCE BLOCK  /  ACADEMIC BLOCK", size: 0.2, color: "#efe6f5", weight: 600, tracking: 0.02 },
        ]}
      />

      {evacueeView && <Facade />}

      {/* plaza furniture with real colliders */}
      <RigidBody type="fixed" colliders="cuboid">
        <Bench position={[-6.5, 0, 15.5]} rotationY={Math.PI / 2} />
        <Bench position={[6.5, 0, 15.5]} rotationY={-Math.PI / 2} />
        <Bench position={[-5, 0, 22.5]} rotationY={Math.PI} />
        <Bench position={[5, 0, 22.5]} rotationY={Math.PI} />
      </RigidBody>
      {(
        [
          [-10.5, 0, 12.5],
          [10.5, 0, 12.5],
          [-12.5, 0, 20.5],
          [12.5, 0, 20.5],
          [-8, 0, 25],
          [8, 0, 25],
        ] as [number, number, number][]
      ).map((position, index) => (
        <RigidBody key={index} type="fixed" colliders={false} position={position}>
          <CuboidCollider args={[0.25, 1.2, 0.25]} position={[0, 1.2, 0]} />
          <Tree position={[0, 0, 0]} scale={1 + (index % 3) * 0.15} tint={index % 2 ? "#5a8a57" : "#4c7a4e"} />
        </RigidBody>
      ))}
      <LampPost position={[-8.5, 0, 14]} />
      <LampPost position={[8.5, 0, 14]} />
      <LampPost position={[-8.5, 0, 21.5]} />
      <LampPost position={[8.5, 0, 21.5]} />
      <BannerPole
        id="banner-learn"
        position={[-4.4, 0, 13.2]}
        background="#3b2a5c"
        lines={[
          { text: "LEARN", size: 0.085, color: "#f4ecff", weight: 800, tracking: 0.01 },
          { text: "PREPARE", size: 0.085, color: "#f4ecff", weight: 800, tracking: 0.01 },
          { text: "PROTECT", size: 0.085, color: "#ffc44d", weight: 800, tracking: 0.01 },
        ]}
      />
      <BannerPole
        id="banner-curiosity"
        position={[4.4, 0, 13.2]}
        rotationY={Math.PI}
        background="#4a2a4f"
        lines={[
          { text: "CURIOSITY", size: 0.075, color: "#f4ecff", weight: 800, tracking: 0.005 },
          { text: "SAVES", size: 0.075, color: "#f4ecff", weight: 800, tracking: 0.005 },
          { text: "LIVES", size: 0.075, color: "#ff6a3d", weight: 800, tracking: 0.005 },
        ]}
      />
      <Sculpture position={[10, 0, 18]} />

      <Skyline />
      <AssemblyPoint />
    </>
  );
}
