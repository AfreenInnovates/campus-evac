"use client";

import { memo, Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { Physics, useRapier } from "@react-three/rapier";
import * as THREE from "three";
import Building from "../components/Building";
import Exterior from "../components/Exterior";
import Rooms from "../components/Rooms";
import { Glow } from "../components/Decor";
import { ROOMS, roomHeight, SUN_DIRECTION } from "../level";
import { clampDt } from "../runtime";
import { buildGrid } from "./nav";
import { lab, step, useLab } from "./engine";
import { create } from "zustand";
import { fireSpot, INDOOR, LINKS, placeName, roomCenter, smokeAt } from "./world";

/** Which person the spectator camera is riding along with, and whether the map is ready. */
export const useSpectator = create<{ follow: number | null; navReady: boolean }>(() => ({ follow: null, navReady: false }));

/* ------------------------------------------------------------------ navigation map */

/** Reads the walkable floor off the building's colliders once they have all mounted. */
function NavBuilder() {
  const { world, rapier } = useRapier();
  useEffect(() => {
    let cancelled = false;
    let last = -1;
    let stable = 0;
    // colliders mount over a few frames; wait until their count stops changing
    const wait = window.setInterval(() => {
      const count = world.colliders.len();
      stable = count === last ? stable + 1 : 0;
      last = count;
      if (stable < 3 || cancelled) return;
      window.clearInterval(wait);
      world.step(); // refresh the query structures; only fixed bodies exist, so nothing moves
      const shape = new rapier.Cuboid(0.24, 0.45, 0.24);
      const rotation = { x: 0, y: 0, z: 0, w: 1 };
      const probe = (x: number, z: number) => world.intersectionWithShape({ x, y: 0.9, z }, rotation, shape) !== null;
      lab.grid = buildGrid(probe);
      useSpectator.setState({ navReady: true });
    }, 150);
    return () => {
      cancelled = true;
      window.clearInterval(wait);
    };
  }, [world, rapier]);
  return null;
}

/* ------------------------------------------------------------------ people */

function Person({ index }: { index: number }) {
  const group = useRef<THREE.Group>(null);
  const body = useRef<THREE.Mesh>(null);
  // A string, not the agent object: the snapshot is rebuilt four times a second, and a figure
  // only needs to redraw when its tag actually changes.
  const tag = useLab((s) => {
    const a = s.snap?.agents[index];
    if (!a) return "";
    // a thought shows for a few seconds after each decision, so you can see the person think
    const live = lab.agents[index];
    const thinking = (agent: (typeof lab.agents)[number]) => agent.status === "inside" && agent.decisions > 0 && lab.t - agent.lastDecisionAt < 4.5;
    // at most three bubbles at once, the newest thoughts, so a crowd never turns into a wall of text
    // ties (everyone decides at once when the alarm goes) are broken by number, so the cap holds
    const newer = live
      ? lab.agents.filter((other) => other !== live && thinking(other) && (other.lastDecisionAt > live.lastDecisionAt || (other.lastDecisionAt === live.lastDecisionAt && other.id < live.id))).length
      : 99;
    const fresh = live && thinking(live) && newer < 3 ? live.thought : "";
    const order = a.order && a.status === "inside" ? (a.order.status === "following" || a.order.status === "done" ? "✓" : a.order.status === "ignored" ? "✗" : "") : "";
    return [a.id, a.color, a.status, a.deciding ? 1 : 0, fresh.slice(0, 90), order].join("\u0001");
  });
  const follow = useSpectator((s) => s.follow);
  const bob = useRef(index * 1.7); // out of step with each other

  useFrame((_, rawDt) => {
    const live = lab.agents[index];
    const g = group.current;
    if (!live || !g) return;
    const dt = clampDt(rawDt);
    const moving = !!live.path && live.status === "inside";
    bob.current += moving ? dt * (live.pace === "run" ? 14 : 8) : 0;
    g.position.set(live.x, 0, live.z);
    g.rotation.y += ((((live.heading - g.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, dt * 10));
    if (body.current) {
      const crawl = live.pace === "crawl" && live.status === "inside";
      const down = live.status === "down";
      body.current.rotation.x = down ? Math.PI / 2 : crawl ? 1.0 : 0;
      body.current.position.y = down ? 0.2 : crawl ? 0.45 : 0.62 + (moving ? Math.abs(Math.sin(bob.current)) * 0.06 : 0);
    }
  });

  if (!tag) return null;
  const [idText, color, status, deciding, thought, order] = tag.split("\u0001");
  const id = Number(idText);
  const selected = follow === id;
  const tint = status === "down" ? "#5b5560" : color;
  return (
    <group ref={group}>
      <group ref={body}>
        <mesh position={[0, 0, 0]}>
          <capsuleGeometry args={[0.22, 0.62, 4, 10]} />
          <meshStandardMaterial color={tint} roughness={0.55} />
        </mesh>
        <mesh position={[0, 0.62, 0]}>
          <sphereGeometry args={[0.19, 14, 10]} />
          <meshStandardMaterial color="#f3d8c2" roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.66, 0.16]}>
          <boxGeometry args={[0.18, 0.05, 0.05]} />
          <meshStandardMaterial color="#231c2b" />
        </mesh>
      </group>
      <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.34, selected ? 0.5 : 0.42, 28]} />
        <meshBasicMaterial color={selected ? "#ffffff" : tint} transparent opacity={0.85} toneMapped={false} />
      </mesh>
      <Html position={[0, 1.55, 0]} center zIndexRange={[9, 0]} style={{ pointerEvents: "none" }}>
        <div
          style={{
            font: "800 10px/1 var(--font-geist-mono), monospace",
            color: "#16111e",
            background: tint,
            border: "2px solid #16111e",
            padding: "2px 5px",
            whiteSpace: "nowrap",
            opacity: status === "safe" ? 0.55 : 1,
          }}
        >
          {id}
          {deciding === "1" ? " …" : ""}
          {order && <span style={{ marginLeft: 3, color: order === "✓" ? "#065f46" : "#991b1b" }}>{order}</span>}
        </div>
      </Html>
      {thought && (
        <Html position={[0, 2.2, 0]} center zIndexRange={[8, 0]} style={{ pointerEvents: "none" }}>
          <div className="hud-rise" style={{ width: 150, font: "italic 600 10.5px/1.25 var(--font-geist-sans), sans-serif", color: "#16111e", background: "#fffaf3", border: "2px solid #16111e", padding: "4px 7px", boxShadow: "2px 2px 0 #16111e" }}>
            “{thought}”
          </div>
        </Html>
      )}
    </group>
  );
}

/** Faint room names, the exits in green, and the fire: enough to read the map at a glance. */
function Signposts() {
  const origin = useLab((s) => (s.snap ? lab.scenario?.origin : undefined));
  const chip = (background: string, color: string, size = 11): React.CSSProperties => ({
    font: `900 ${size}px/1 var(--font-geist-sans), sans-serif`,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
    background,
    color,
    padding: "3px 7px",
  });
  return (
    <>
      {INDOOR.filter((room) => room !== "wcorr" && room !== "ecorr").map((room) => {
        const [x, z] = roomCenter(room);
        return (
          <Html key={room} position={[x, 0.2, z]} center zIndexRange={[4, 0]} style={{ pointerEvents: "none" }}>
            <div style={{ ...chip("rgba(22,17,30,0.55)", "rgba(255,250,243,0.8)", 10) }}>{placeName(room)}</div>
          </Html>
        );
      })}
      {LINKS.filter((link) => link.exit).map((link) => (
        <Html key={link.id} position={[link.door[0], 2.4, link.door[1]]} center zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
          <div style={chip("#16a34a", "#ffffff")}>Exit</div>
        </Html>
      ))}
      {origin && (
        <Html position={[fireSpot(origin)[0], 2.8, fireSpot(origin)[1]]} center zIndexRange={[6, 0]} style={{ pointerEvents: "none" }}>
          <div style={chip("#ef4444", "#ffffff", 13)}>🔥 Fire</div>
        </Html>
      )}
    </>
  );
}

function People() {
  const count = useLab((s) => s.snap?.agents.length ?? 0);
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <Person key={i} index={i} />
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ fire and smoke */

function Fire() {
  // re-render only when a new run picks a different fire room
  const origin = useLab((s) => (s.snap ? lab.scenario?.origin : undefined));
  const flames = useRef<THREE.Group>(null);
  const light = useRef<THREE.PointLight>(null);
  useFrame(({ clock }) => {
    const grow = Math.min(1, lab.t / 25) * (lab.scenario ? 1 : 0);
    const flicker = 0.85 + Math.sin(clock.elapsedTime * 17) * 0.08 + Math.sin(clock.elapsedTime * 7.3) * 0.07;
    if (flames.current) {
      flames.current.scale.setScalar(0.35 + grow * 0.9 * flicker);
      flames.current.visible = lab.t > 0.5;
    }
    if (light.current) light.current.intensity = lab.t > 0.5 ? (4 + grow * 16) * flicker : 0;
  });
  if (!origin) return null;
  const [x, z] = fireSpot(origin);
  return (
    <group position={[x, 0, z]}>
      <group ref={flames}>
        {[
          [0, 0, 0, 1.3, 0.55, "#ff8a1f"],
          [0.35, 0, 0.2, 0.9, 0.38, "#ffc44d"],
          [-0.3, 0, -0.15, 1, 0.42, "#ff5a1f"],
          [0.05, 0, 0.35, 0.7, 0.3, "#fff1a8"],
        ].map(([fx, , fz, h, r, color], i) => (
          // drawn over the smoke haze, or the haze greys the flames out from above
          <mesh key={i} position={[fx as number, (h as number) / 2, fz as number]} renderOrder={12}>
            <coneGeometry args={[r as number, h as number, 9]} />
            <meshBasicMaterial color={new THREE.Color(color as string).multiplyScalar(2.2)} transparent opacity={0.92} depthTest={false} toneMapped={false} />
          </mesh>
        ))}
      </group>
      <Glow position={[0, 1, 0]} color="#ff7a2e" size={6} opacity={0.6} />
      {/* scorched floor so the seat of the fire reads even once the smoke is thick */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={11}>
        <circleGeometry args={[1.6, 24]} />
        <meshBasicMaterial color="#ff4a1a" transparent opacity={0.55} depthTest={false} toneMapped={false} />
      </mesh>
      <pointLight ref={light} position={[0, 1.4, 0]} distance={12} decay={1.8} color="#ff6a2a" intensity={0} />
    </group>
  );
}

/** Grey haze over each room, thickening as the smoke model says. Seen by spectator and CCTV alike. */
function SmokeHaze() {
  const materials = useMemo(
    () => INDOOR.map(() => new THREE.MeshBasicMaterial({ color: "#8a8286", transparent: true, opacity: 0, depthWrite: false })),
    [],
  );
  useFrame(() => {
    INDOOR.forEach((room, i) => {
      materials[i].opacity = Math.min(0.72, smokeAt(room, lab.t, lab.hops) * 0.78);
    });
  });
  return (
    <>
      {INDOOR.map((room, i) => {
        const b = ROOMS.find((r) => r.id === room)!.bounds;
        return (
          <mesh
            key={room}
            position={[(b.minX + b.maxX) / 2, Math.min(2.4, roomHeight(room) - 1.2), (b.minZ + b.maxZ) / 2]}
            rotation={[-Math.PI / 2, 0, 0]}
            material={materials[i]}
            renderOrder={8}
          >
            <planeGeometry args={[b.maxX - b.minX, b.maxZ - b.minZ]} />
          </mesh>
        );
      })}
    </>
  );
}

/* ------------------------------------------------------------------ the warden's camera */

const CAM = { minX: -27, maxX: 27, minZ: -27.5, maxZ: 19.5 };
const SHOT_W = 1024;
const SHOT_H = Math.round((SHOT_W * (CAM.maxZ - CAM.minZ)) / (CAM.maxX - CAM.minX));

/**
 * A fixed ceiling camera looking straight down on the whole building. When the warden asks
 * for a frame it is rendered off-screen, then labelled the way a real CCTV map overlay would
 * be: room names, the exits, and a numbered tag on each person, so the vision model can
 * refer to people by number.
 */
function CCTV() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useMemo(() => {
    const cam = new THREE.OrthographicCamera(CAM.minX, CAM.maxX, -CAM.minZ, -CAM.maxZ, 1, 200);
    cam.position.set(0, 90, 0);
    cam.up.set(0, 0, -1);
    cam.lookAt(0, 0, 0);
    // after lookAt with north up, left/right/top/bottom are in camera space: x east, y north
    cam.left = CAM.minX;
    cam.right = CAM.maxX;
    cam.top = -CAM.minZ;
    cam.bottom = -CAM.maxZ;
    cam.updateProjectionMatrix();
    return cam;
  }, []);
  const target = useMemo(() => {
    const rt = new THREE.WebGLRenderTarget(SHOT_W, SHOT_H);
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    return rt;
  }, []);

  useEffect(() => {
    const pixels = new Uint8Array(SHOT_W * SHOT_H * 4);
    const canvas = document.createElement("canvas");
    canvas.width = SHOT_W;
    canvas.height = SHOT_H;
    const ctx = canvas.getContext("2d")!;
    const px = (x: number) => ((x - CAM.minX) / (CAM.maxX - CAM.minX)) * SHOT_W;
    const pz = (z: number) => ((z - CAM.minZ) / (CAM.maxZ - CAM.minZ)) * SHOT_H;

    lab.capture = async () => {
      const previous = gl.getRenderTarget();
      gl.setRenderTarget(target);
      gl.render(scene, camera);
      gl.setRenderTarget(previous);
      gl.readRenderTargetPixels(target, 0, 0, SHOT_W, SHOT_H, pixels);
      const image = ctx.createImageData(SHOT_W, SHOT_H);
      // WebGL rows run bottom-up
      for (let row = 0; row < SHOT_H; row++) {
        const src = (SHOT_H - 1 - row) * SHOT_W * 4;
        image.data.set(pixels.subarray(src, src + SHOT_W * 4), row * SHOT_W * 4);
      }
      ctx.putImageData(image, 0, 0);

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "bold 16px sans-serif";
      for (const room of INDOOR) {
        if (room === "wcorr" || room === "ecorr") continue;
        const [x, z] = roomCenter(room);
        const label = placeName(room).toUpperCase();
        const w = ctx.measureText(label).width + 10;
        ctx.fillStyle = "rgba(10,8,16,0.8)";
        ctx.fillRect(px(x) - w / 2, pz(z) - 12, w, 24);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(label, px(x), pz(z));
      }
      for (const link of LINKS) {
        if (!link.exit) continue;
        const [x, z] = link.door;
        ctx.fillStyle = "#16a34a";
        ctx.fillRect(px(x) - 26, pz(z) - 12, 52, 24);
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 14px sans-serif";
        ctx.fillText("EXIT", px(x), pz(z));
      }
      ctx.font = "bold 15px sans-serif";
      for (const agent of lab.agents) {
        if (agent.status === "safe") continue;
        const x = px(agent.x);
        const y = pz(agent.z);
        ctx.beginPath();
        ctx.arc(x, y, 13, 0, Math.PI * 2);
        ctx.fillStyle = agent.status === "down" ? "#555" : agent.color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#000";
        ctx.stroke();
        ctx.fillStyle = "#000";
        ctx.fillText(String(agent.id), x, y + 1);
      }
      // encode off the render path: toDataURL would stall the frame for tens of milliseconds
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.78));
      if (!blob) return null;
      return await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(blob);
      });
    };
    return () => {
      lab.capture = null;
    };
  }, [gl, scene, camera, target]);

  return null;
}

/* ------------------------------------------------------------------ spectator camera */

function Spectator() {
  const controls = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  const goal = useMemo(() => new THREE.Vector3(0, 0, -6), []);
  useFrame((_, rawDt) => {
    const follow = useSpectator.getState().follow;
    const agent = follow ? lab.agents.find((a) => a.id === follow) : null;
    const c = controls.current;
    if (!c || !agent) return;
    goal.set(agent.x, 0.8, agent.z);
    const k = Math.min(1, clampDt(rawDt) * 3);
    const shift = goal.clone().sub(c.target).multiplyScalar(k);
    c.target.add(shift);
    c.object.position.add(shift);
    c.update();
  });
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      target={[0, 0, -6]}
      maxPolarAngle={1.35}
      minDistance={6}
      maxDistance={80}
      enableDamping
      dampingFactor={0.08}
    />
  );
}

/**
 * Nothing that casts a shadow here ever moves, so the sun's shadow map is drawn once, after
 * the building has mounted, and then left alone instead of being redrawn every frame.
 */
function StaticShadows() {
  const get = useThree((s) => s.get);
  const ready = useSpectator((s) => s.navReady);
  useEffect(() => {
    const shadows = get().gl.shadowMap;
    shadows.autoUpdate = false;
    shadows.needsUpdate = true;
    return () => {
      shadows.autoUpdate = true;
    };
  }, [get, ready]);
  return null;
}

/* ------------------------------------------------------------------ loop */

function Loop() {
  useFrame((_, rawDt) => step(clampDt(rawDt)));
  return null;
}

const SUN = new THREE.Vector3(...SUN_DIRECTION).normalize();

export default memo(function CrowdScene() {
  return (
    <Canvas
      shadows="percentage"
      dpr={typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches ? 1 : [1, 1.5]}
      camera={{ position: [0, 44, 30], fov: 45, near: 0.5, far: 400 }}
      gl={{ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: false }}
      style={{ position: "absolute", inset: 0 }}
    >
      <Suspense fallback={null}>
        <ambientLight intensity={0.55} color="#fff0e0" />
        <hemisphereLight color="#d9d2f0" groundColor="#3a2a30" intensity={0.7} />
        <directionalLight
          castShadow
          position={[SUN.x * 45, SUN.y * 45 + 30, SUN.z * 45]}
          intensity={1.8}
          color="#ffc9a0"
          shadow-mapSize={[1024, 1024]}
          shadow-camera-left={-34}
          shadow-camera-right={34}
          shadow-camera-top={34}
          shadow-camera-bottom={-34}
          shadow-camera-far={160}
          shadow-bias={-0.0004}
        />
        <Physics paused>
          <Exterior />
          <Building />
          <Rooms />
          <NavBuilder />
        </Physics>
        <StaticShadows />
        <People />
        <Signposts />
        <Fire />
        <SmokeHaze />
        <CCTV />
        <Spectator />
        <Loop />
      </Suspense>
    </Canvas>
  );
});
