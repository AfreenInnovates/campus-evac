"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { clampDt } from "../runtime";
import { lab } from "./engine";
import { smokeAt } from "./world";

/**
 * One evacuee as a jointed 3D person: hips, knees, shoulders, elbows and head, posed every
 * frame from what the simulation says they are doing. Walking, running, crawling under smoke,
 * freezing in panic, sheltering, covering their mouth, collapsing; a wheelchair user pushes
 * their own wheels, an elderly professor leans on a cane.
 *
 * Geometry and materials are shared between everyone, and nothing here re-renders React:
 * the joints are moved directly, so a crowd costs about what a few static meshes would.
 */

const G = {
  pelvis: new THREE.BoxGeometry(0.3, 0.16, 0.19),
  chest: new THREE.CapsuleGeometry(0.15, 0.26, 6, 12),
  neck: new THREE.CylinderGeometry(0.045, 0.05, 0.09, 8),
  head: new THREE.SphereGeometry(0.11, 16, 12),
  hairCap: new THREE.SphereGeometry(0.119, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.52),
  hairLong: new THREE.BoxGeometry(0.2, 0.24, 0.06),
  bun: new THREE.SphereGeometry(0.055, 10, 8),
  eye: new THREE.SphereGeometry(0.014, 6, 4),
  upperArm: new THREE.CapsuleGeometry(0.046, 0.19, 4, 8),
  forearm: new THREE.CapsuleGeometry(0.04, 0.17, 4, 8),
  hand: new THREE.SphereGeometry(0.045, 8, 6),
  thigh: new THREE.CapsuleGeometry(0.068, 0.28, 4, 8),
  shin: new THREE.CapsuleGeometry(0.056, 0.3, 4, 8),
  shoe: new THREE.BoxGeometry(0.1, 0.07, 0.22),
  // wheelchair
  wheel: new THREE.TorusGeometry(0.3, 0.022, 8, 28),
  spoke: new THREE.BoxGeometry(0.01, 0.58, 0.01),
  hub: new THREE.CylinderGeometry(0.035, 0.035, 0.05, 10),
  caster: new THREE.CylinderGeometry(0.06, 0.06, 0.035, 12),
  seat: new THREE.BoxGeometry(0.46, 0.05, 0.44),
  back: new THREE.BoxGeometry(0.44, 0.42, 0.04),
  rail: new THREE.BoxGeometry(0.025, 0.025, 0.5),
  post: new THREE.BoxGeometry(0.025, 0.42, 0.025),
  footrest: new THREE.BoxGeometry(0.34, 0.025, 0.14),
  // props
  cane: new THREE.CylinderGeometry(0.012, 0.012, 0.86, 6),
  caneHandle: new THREE.BoxGeometry(0.022, 0.022, 0.1),
  band: new THREE.TorusGeometry(0.125, 0.014, 6, 16, Math.PI),
  cup: new THREE.CylinderGeometry(0.045, 0.045, 0.04, 12),
  shadow: new THREE.CircleGeometry(0.42, 20),
};

const materials = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: string, roughness = 0.78, metalness = 0) {
  const key = `${color}|${roughness}|${metalness}`;
  let m = materials.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    materials.set(key, m);
  }
  return m;
}

let shadowMaterial: THREE.MeshBasicMaterial | null = null;
function softShadow() {
  if (shadowMaterial) return shadowMaterial;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(0,0,0,0.55)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  shadowMaterial = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false });
  return shadowMaterial;
}

const SKIN = ["#f1c9a5", "#e0ac69", "#c68642", "#8d5524", "#5c3a21", "#f6d7c3"];
const HAIR = ["#1b1410", "#3b2416", "#6b4423", "#c9a15a", "#2a2a2a", "#8a3b1e"];
const PANTS = ["#1f2a44", "#2b2b2b", "#3d3a35", "#24324a", "#4a3b2a", "#2f3e2f"];

/** Everyone looks different, and the same person looks the same in every drill. */
function lookOf(id: number, kind: string) {
  return {
    skin: SKIN[(id * 7 + 3) % SKIN.length],
    hair: kind === "elderly" ? "#d9d6d0" : HAIR[(id * 5 + 1) % HAIR.length],
    hairStyle: kind === "elderly" ? 0 : (id * 3 + 1) % 3,
    pants: PANTS[(id * 11) % PANTS.length],
  };
}

const JOINTS = ["body", "hips", "torso", "head", "shA", "elA", "shB", "elB", "hipA", "knA", "hipB", "knB", "wheelA", "wheelB"] as const;
type Joints = Partial<Record<(typeof JOINTS)[number], THREE.Object3D>>;

export default function Human({ index, id, kind, shirt }: { index: number; id: number; kind: string; shirt: string }) {
  const look = useMemo(() => lookOf(id, kind), [id, kind]);
  const seated = kind === "wheelchair";
  const root = useRef<THREE.Group>(null);
  // the jointed groups, found by name once the figure has mounted
  const joints = useRef<Joints | null>(null);
  const motion = useRef({ phase: id * 1.3, spin: 0, x: NaN, z: NaN });

  useFrame(({ clock }, rawDt) => {
    const a = lab.agents[index];
    if (!a || !root.current) return;
    if (!joints.current) {
      const found: Joints = {};
      root.current.traverse((o) => {
        if ((JOINTS as readonly string[]).includes(o.name)) found[o.name as keyof Joints] = o;
      });
      joints.current = found;
    }
    const j = joints.current;
    const dt = clampDt(rawDt);
    const T = clock.elapsedTime + id * 3.1;
    const m = motion.current;
    const moved = Number.isNaN(m.x) ? 0 : Math.hypot(a.x - m.x, a.z - m.z);
    m.x = a.x;
    m.z = a.z;

    const inside = a.status === "inside";
    const down = a.status === "down";
    const frozen = inside && a.frozenUntil > lab.t;
    const moving = inside && !frozen && !!a.path && !a.sheltering;
    const crawl = moving && a.pace === "crawl" && !seated;
    const run = moving && a.pace === "run";
    const smoky = inside && smokeAt(a.room, lab.t, lab.hops) > 0.15;
    const elderly = kind === "elderly";

    const cadence = !moving ? 0 : seated ? 3.4 : crawl ? 4.5 : run ? 10.5 : elderly ? 4.6 : 6.8 * a.persona.speed;
    m.phase += dt * cadence;
    m.spin += moved / 0.3;
    const p = m.phase;
    const s = Math.sin(p);
    const c = Math.cos(p);

    // a neutral standing pose, then whatever they are doing on top of it
    let hipsY = 0.93;
    let hipsX = 0;
    let bodyX = 0;
    let bodyY = 0;
    let torsoX = 0.02 + Math.sin(T * 1.6) * 0.012;
    let torsoY = 0;
    let headX = 0;
    let headY = Math.sin(T * 0.45) * 0.35;
    let shA = 0.04;
    let shAz = 0.07;
    let elA = -0.12;
    let shB = 0.04;
    let shBz = -0.07;
    let elB = -0.12;
    let hipA = 0;
    let hipB = 0;
    let knA = 0.04;
    let knB = 0.04;

    if (down) {
      bodyX = -1.5;
      bodyY = 0.12;
      headY = 0.5;
      torsoX = 0;
      shAz = 0.9;
      shBz = -0.7;
      elA = -0.4;
      elB = -0.2;
      hipA = -0.15;
      knA = 0.3;
    } else if (seated) {
      hipsY = 0.56;
      hipA = hipB = -1.5;
      knA = knB = 1.45;
      shAz = 0.28;
      shBz = -0.28;
      elA = elB = -0.55;
      if (moving) {
        // both hands push the rims together
        shA = shB = -0.15 + s * 0.5;
        elA = elB = -0.75 + c * 0.25;
        torsoX = 0.1 + Math.max(0, s) * 0.14;
      } else {
        shA = shB = 0.25;
      }
    } else if (a.sheltering) {
      hipsY = 0.17;
      hipA = hipB = -1.35;
      knA = knB = 2.0;
      torsoX = 0.38;
      headX = 0.35;
      headY = 0;
      shA = -0.9;
      elA = -0.9;
      shB = -1.25;
      elB = -2.05;
    } else if (frozen) {
      // hands on head, rooted to the spot, shaking, eyes darting
      hipsY = 0.88;
      hipsX = Math.sin(T * 47) * 0.012;
      hipA = hipB = -0.18;
      knA = knB = 0.32;
      torsoX = 0.14;
      headY = Math.sin(T * 2.6) * 0.75;
      headX = 0.05;
      shA = shB = -2.65;
      shAz = 0.45;
      shBz = -0.45;
      elA = elB = -1.95;
    } else if (crawl) {
      hipsY = 0.48;
      torsoX = 1.38;
      headX = -1.05;
      headY = 0;
      hipA = s * 0.25;
      hipB = -s * 0.25;
      knA = knB = 1.55;
      shA = -1.38 - s * 0.3;
      shB = -1.38 + s * 0.3;
      shAz = 0.12;
      shBz = -0.12;
      elA = elB = -0.05;
    } else if (moving) {
      const stride = run ? 0.75 : elderly ? 0.26 : 0.42;
      hipA = -s * stride;
      hipB = s * stride;
      knA = (run ? 0.15 : 0.06) + Math.max(0, c) * (run ? 1.5 : 0.75);
      knB = (run ? 0.15 : 0.06) + Math.max(0, -c) * (run ? 1.5 : 0.75);
      shA = s * (run ? 0.7 : 0.34);
      shB = -s * (run ? 0.7 : 0.34);
      elA = elB = run ? -1.45 : -0.28;
      hipsY = run ? 0.88 + Math.abs(c) * 0.06 : 0.915 + Math.abs(c) * 0.022;
      torsoX = run ? 0.3 : 0.06;
      torsoY = s * (run ? 0.14 : 0.08);
      headX = run ? -0.22 : -0.04;
      headY = 0;
    }

    if (elderly && !down && !a.sheltering && !frozen) {
      // a stoop, and the cane planted ahead on the right
      torsoX += 0.2;
      headX -= 0.15;
      shB = -0.3 + (moving ? s * 0.12 : 0);
      elB = -0.35;
    }

    // in smoke, a sleeve over the mouth; with damaged lungs, a cough now and then
    if ((smoky || a.health < 60) && inside && !frozen && !crawl && !down) {
      shB = -1.2;
      elB = -2.05;
      shBz = -0.25;
      const cough = a.health < 60 ? Math.pow(Math.max(0, Math.sin(T * 2.2)), 10) : 0;
      torsoX += cough * 0.35;
      headX += cough * 0.25;
    }

    const set = (joint: THREE.Object3D | undefined, x: number, z = 0, y = 0) => joint?.rotation.set(x, y, z);
    if (j.body) {
      j.body.rotation.x = bodyX;
      j.body.position.y = bodyY;
    }
    j.hips?.position.set(hipsX, hipsY, 0);
    set(j.torso, torsoX, 0, torsoY);
    set(j.head, headX, 0, headY);
    set(j.shA, shA, shAz);
    set(j.elA, elA);
    set(j.shB, shB, shBz);
    set(j.elB, elB);
    set(j.hipA, hipA);
    set(j.knA, knA);
    set(j.hipB, hipB);
    set(j.knB, knB);
    set(j.wheelA, m.spin);
    set(j.wheelB, m.spin);
  });

  const skin = mat(look.skin, 0.62);
  const cloth = mat(shirt, 0.82);
  const pants = mat(look.pants, 0.86);
  const hair = mat(look.hair, 0.7);
  const dark = mat("#1d1a22", 0.6);
  const metal = mat("#9aa3ad", 0.35, 0.7);
  const frame = mat("#2b2f3a", 0.5, 0.3);

  const arm = (side: 1 | -1, sh: string, el: string, extra?: React.ReactNode) => (
    <group name={sh} position={[0.2 * side, 0.42, 0]}>
      <mesh geometry={G.upperArm} material={cloth} position={[0, -0.14, 0]} castShadow />
      <group name={el} position={[0, -0.29, 0]}>
        <mesh geometry={G.forearm} material={skin} position={[0, -0.12, 0]} />
        <mesh geometry={G.hand} material={skin} position={[0, -0.26, 0]} />
        {extra}
      </group>
    </group>
  );
  const leg = (side: 1 | -1, hip: string, knee: string) => (
    <group name={hip} position={[0.095 * side, -0.04, 0]}>
      <mesh geometry={G.thigh} material={pants} position={[0, -0.2, 0]} />
      <group name={knee} position={[0, -0.42, 0]}>
        <mesh geometry={G.shin} material={pants} position={[0, -0.2, 0]} />
        <mesh geometry={G.shoe} material={dark} position={[0, -0.43, 0.04]} />
      </group>
    </group>
  );

  return (
    <group ref={root} scale={0.9}>
      <mesh geometry={G.shadow} material={softShadow()} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]} scale={seated ? 1.3 : 1} />
      {seated && (
        <group>
          <mesh geometry={G.seat} material={frame} position={[0, 0.5, 0]} />
          <mesh geometry={G.back} material={frame} position={[0, 0.76, -0.22]} rotation={[-0.12, 0, 0]} />
          {[0.23, -0.23].map((x) => (
            <group key={x}>
              <mesh geometry={G.rail} material={metal} position={[x, 0.46, 0.02]} />
              <mesh geometry={G.post} material={metal} position={[x * 0.87, 0.28, 0.24]} />
              <mesh geometry={G.caster} material={dark} position={[x * 0.87, 0.06, 0.28]} rotation={[0, 0, Math.PI / 2]} />
            </group>
          ))}
          <mesh geometry={G.footrest} material={frame} position={[0, 0.1, 0.42]} />
          {([
            [0.3, "wheelA"],
            [-0.3, "wheelB"],
          ] as const).map(([x, name]) => (
            <group key={x} name={name} position={[x, 0.31, -0.06]}>
              <mesh geometry={G.wheel} material={dark} rotation={[0, Math.PI / 2, 0]} />
              <mesh geometry={G.hub} material={metal} rotation={[0, 0, Math.PI / 2]} />
              {[0, Math.PI / 3, (2 * Math.PI) / 3].map((angle) => (
                <mesh key={angle} geometry={G.spoke} material={metal} rotation={[angle, 0, 0]} />
              ))}
            </group>
          ))}
        </group>
      )}
      <group name="body">
        <group name="hips" position={[0, 0.93, 0]}>
          <mesh geometry={G.pelvis} material={pants} castShadow />
          {leg(1, "hipA", "knA")}
          {leg(-1, "hipB", "knB")}
          <group name="torso" position={[0, 0.06, 0]}>
            <mesh geometry={G.chest} material={cloth} position={[0, 0.25, 0]} scale={[1.15, 1, 0.78]} castShadow />
            <mesh geometry={G.neck} material={skin} position={[0, 0.5, 0]} />
            <group name="head" position={[0, 0.54, 0]}>
              <mesh geometry={G.head} material={skin} position={[0, 0.1, 0.005]} scale={[0.92, 1.05, 1]} />
              <mesh geometry={G.hairCap} material={hair} position={[0, 0.112, -0.01]} />
              {look.hairStyle === 1 && <mesh geometry={G.hairLong} material={hair} position={[0, 0.03, -0.085]} />}
              {look.hairStyle === 2 && <mesh geometry={G.bun} material={hair} position={[0, 0.2, -0.09]} />}
              {[0.038, -0.038].map((x) => (
                <mesh key={x} geometry={G.eye} material={dark} position={[x, 0.115, 0.1]} />
              ))}
              {kind === "headphones" && (
                <group position={[0, 0.1, 0]}>
                  <mesh geometry={G.band} material={dark} />
                  {[0.118, -0.118].map((x) => (
                    <mesh key={x} geometry={G.cup} material={cloth} position={[x, -0.01, 0]} rotation={[0, 0, Math.PI / 2]} />
                  ))}
                </group>
              )}
            </group>
            {arm(1, "shA", "elA")}
            {arm(
              -1,
              "shB",
              "elB",
              kind === "elderly" ? (
                <group position={[0, -0.27, 0]}>
                  <mesh geometry={G.caneHandle} material={dark} position={[0, 0, 0.03]} />
                  <mesh geometry={G.cane} material={mat("#5a3b22", 0.5)} position={[0, -0.43, 0]} />
                </group>
              ) : null,
            )}
          </group>
        </group>
      </group>
    </group>
  );
}
