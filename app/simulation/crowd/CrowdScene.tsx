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
import { SUN_DIRECTION } from "../level";
import { clampDt } from "../runtime";
import { buildGrid } from "./nav";
import { lab, step, useLab } from "./engine";
import { create } from "zustand";
import { fireSpot, floorHeight, INDOOR, LINKS, placeName, plan, roomById, roomCenter, smokeAt, usePlan, WEST_STEPS, type Plan } from "./world";
import Human from "./Human";
import { hasFix } from "./fixes";
import { addCrowdFrames, addFrames, emptyHeat, heatArea, paintHeat } from "./heat";
import CrowdInstances from "./CrowdInstances";
import DesignedBuilding from "./DesignedBuilding";

/** Which person the spectator camera is riding along with, and whether the map is ready. */
export const useSpectator = create<{ follow: number | null; navReady: boolean; heat: boolean }>(() => ({ follow: null, navReady: false, heat: false }));

/* ------------------------------------------------------------------ navigation map */

/** Reads the walkable floor off the building's colliders once they have all mounted. */
function NavBuilder() {
  const { world, rapier } = useRapier();
  // colliders mount over a few frames; build once their count has held steady for a few frames
  const watch = useRef({ last: -1, stable: 0, done: false });
  // a new building: wait for it to be read before anyone can sound the alarm
  useEffect(() => useSpectator.setState({ navReady: false }), []);
  useFrame(() => {
    const w = watch.current;
    if (w.done) return;
    const count = world.colliders.len();
    w.stable = count === w.last ? w.stable + 1 : 0;
    w.last = count;
    if (w.stable < 4) return;
    w.done = true;
    world.step(); // refresh the query structures; only fixed bodies exist, so nothing moves
    const shape = new rapier.Cuboid(0.24, 0.45, 0.24);
    const rotation = { x: 0, y: 0, z: 0, w: 1 };
    const probe = (x: number, z: number) => world.intersectionWithShape({ x, y: 0.9, z }, rotation, shape) !== null;
    // the building plus a margin outside it, so people can walk clear of the doors
    const b = plan.bounds;
    lab.grid = buildGrid(probe, { minX: b.minX - 9, maxX: b.maxX + 9, minZ: b.minZ - 8, maxZ: b.maxZ + 18 });
    useSpectator.setState({ navReady: true });
  });
  return null;
}

/* ------------------------------------------------------------------ people */

function Person({ index }: { index: number }) {
  const group = useRef<THREE.Group>(null);
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
    return [a.id, a.color, a.status, a.deciding ? 1 : 0, fresh.slice(0, 90), order, a.persona.kind, a.persona.icon ?? ""].join("\u0001");
  });
  const follow = useSpectator((s) => s.follow);

  useFrame((_, rawDt) => {
    const live = lab.agents[index];
    const g = group.current;
    if (!live || !g) return;
    const dt = clampDt(rawDt);
    g.position.set(live.x, floorHeight(live.x, live.z, hasFix(lab.config?.fixes, "ramp")), live.z);
    g.rotation.y += ((((live.heading - g.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, dt * 10));
  });

  if (!tag) return null;
  const [idText, color, status, deciding, thought, order, kind, icon] = tag.split("\u0001");
  const id = Number(idText);
  const selected = follow === id;
  const tint = status === "down" ? "#5b5560" : color;
  return (
    <group ref={group}>
      <Human index={index} id={id} kind={kind} shirt={tint} />
      <mesh position={[0, 0.025, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[selected ? 0.5 : 0.46, selected ? 0.6 : 0.52, 32]} />
        <meshBasicMaterial color={selected ? "#ffffff" : tint} transparent opacity={selected ? 0.95 : 0.7} toneMapped={false} />
      </mesh>
      <Html position={[0, 1.95, 0]} center zIndexRange={[9, 0]} style={{ pointerEvents: "none" }}>
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
          {icon && <span style={{ marginRight: 3 }}>{icon}</span>}
          {id}
          {deciding === "1" ? " …" : ""}
          {order && <span style={{ marginLeft: 3, color: order === "✓" ? "#065f46" : "#991b1b" }}>{order}</span>}
        </div>
      </Html>
      {thought && (
        <Html position={[0, 2.6, 0]} center zIndexRange={[8, 0]} style={{ pointerEvents: "none" }}>
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

/** The landing and steps outside the west fire exit: the one way out a wheelchair cannot take. */
function WestSteps() {
  const ramped = useLab((st) => !!st.snap && hasFix(lab.config?.fixes, "ramp"));
  const s = WEST_STEPS;
  const concrete = useMemo(() => new THREE.MeshStandardMaterial({ color: "#a59f97", roughness: 0.92 }), []);
  const nosing = useMemo(() => new THREE.MeshBasicMaterial({ color: "#facc15", toneMapped: false }), []);
  const blocks = [
    { from: 0, to: s.landing, h: s.rise * s.count },
    ...Array.from({ length: s.count - 1 }, (_, k) => ({ from: s.landing + k * s.tread, to: s.landing + (k + 1) * s.tread, h: s.rise * (s.count - k - 1) })),
  ];
  if (ramped) {
    const top = s.rise * s.count;
    const run = s.rampLength;
    return (
      <group>
        <mesh material={concrete} position={[s.fromX - s.landing / 2, top / 2, s.z]} receiveShadow>
          <boxGeometry args={[s.landing, top, s.halfWidth * 2]} />
        </mesh>
        {/* a wedge: a thin slab tilted down from the landing to the lawn */}
        <mesh material={concrete} position={[s.fromX - s.landing - run / 2, top / 2, s.z]} rotation={[0, 0, Math.atan2(top, run)]} receiveShadow>
          <boxGeometry args={[Math.hypot(run, top), 0.06, s.halfWidth * 2]} />
        </mesh>
        <Html position={[s.fromX - 1.5, 1.3, s.z]} center zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
          <div style={{ font: "800 9px/1.2 var(--font-geist-sans), sans-serif", background: "rgba(22,17,30,0.8)", color: "#2fd18f", padding: "2px 6px", whiteSpace: "nowrap" }}>
            Ramp · step-free
          </div>
        </Html>
      </group>
    );
  }
  return (
    <group>
      {blocks.map((b, i) => (
        <group key={i}>
          <mesh material={concrete} position={[s.fromX - (b.from + b.to) / 2, b.h / 2, s.z]} receiveShadow>
            <boxGeometry args={[b.to - b.from, b.h, s.halfWidth * 2]} />
          </mesh>
          <mesh material={nosing} position={[s.fromX - b.to + 0.03, b.h + 0.003, s.z]}>
            <boxGeometry args={[0.06, 0.006, s.halfWidth * 2]} />
          </mesh>
        </group>
      ))}
      <Html position={[s.fromX - 1, 1.3, s.z]} center zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
        <div style={{ font: "800 9px/1.2 var(--font-geist-sans), sans-serif", background: "rgba(22,17,30,0.8)", color: "#facc15", padding: "2px 6px", whiteSpace: "nowrap" }}>
          Steps · no wheelchair access
        </div>
      </Html>
    </group>
  );
}

/* ------------------------------------------------------------------ heatmap */

/**
 * Where people stood still, glowing on the floor. Painted from the drill's own recording, so
 * it works live, after a drill and on a replay; while a drill runs it refreshes every couple
 * of seconds, never per frame.
 */
/** Seen by the spectator, never by the warden's camera: an orange glow must not read as fire. */
const SPECTATOR_ONLY = 1;

function HeatOverlay({ plan: current }: { plan: Plan }) {
  const on = useSpectator((s) => s.heat);
  const area = heatArea(current.bounds);
  const get = useThree((s) => s.get);
  useEffect(() => {
    get().camera.layers.enable(SPECTATOR_ONLY);
  }, [get]);
  const material = useRef<THREE.MeshBasicMaterial>(null);
  const since = useRef(Infinity);
  useEffect(() => {
    since.current = Infinity; // repaint as soon as it is switched on
  }, [on]);
  useEffect(() => () => material.current?.map?.dispose(), []);
  useFrame((_, dt) => {
    const m = material.current;
    if (!on || !m) return;
    since.current += dt;
    if (since.current < 2) return;
    since.current = 0;
    const frames = lab.playback?.frames ?? lab.rec.frames;
    const heat = addFrames(emptyHeat(heatArea(plan.bounds)), frames, lab.agents.length);
    const crowd = lab.playback?.crowd ?? lab.rec.crowd;
    if (crowd.length) addCrowdFrames(heat, crowd);
    const image = paintHeat(heat);
    if (!m.map) {
      m.map = new THREE.CanvasTexture(image);
      m.map.colorSpace = THREE.SRGBColorSpace;
      m.opacity = 1;
      m.needsUpdate = true;
    } else {
      m.map.image = image;
      m.map.needsUpdate = true;
    }
  });
  // stays mounted, so its one texture is reused rather than rebuilt on every toggle
  return (
    <mesh visible={on} layers={SPECTATOR_ONLY} position={[(area.minX + area.maxX) / 2, 0.07, (area.minZ + area.maxZ) / 2]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={9}>
      <planeGeometry args={[area.maxX - area.minX, area.maxZ - area.minZ]} />
      <meshBasicMaterial ref={material} transparent opacity={0} depthWrite={false} toneMapped={false} />
    </mesh>
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
        const { bounds: b, height } = roomById(room);
        return (
          <mesh
            key={room}
            position={[(b.minX + b.maxX) / 2, Math.min(2.4, height - 1.2), (b.minZ + b.maxZ) / 2]}
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

const SHOT_W = 1024;

/** What the ceiling camera takes in: the building and a margin round it, at a fixed image width. */
function cctvFrame(current: Plan) {
  const b = current.bounds;
  const CAM = { minX: b.minX - 5, maxX: b.maxX + 5, minZ: b.minZ - 4, maxZ: b.maxZ + 9 };
  return { CAM, SHOT_H: Math.round((SHOT_W * (CAM.maxZ - CAM.minZ)) / (CAM.maxX - CAM.minX)) };
}

/**
 * A fixed ceiling camera looking straight down on the whole building. When the warden asks
 * for a frame it is rendered off-screen, then labelled the way a real CCTV map overlay would
 * be: room names, the exits, and a numbered tag on each person, so the vision model can
 * refer to people by number.
 */
function CCTV({ plan: current }: { plan: Plan }) {
  const { CAM, SHOT_H } = useMemo(() => cctvFrame(current), [current]);
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
  }, [CAM]);
  const target = useMemo(() => {
    const rt = new THREE.WebGLRenderTarget(SHOT_W, SHOT_H);
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    return rt;
  }, [SHOT_H]);

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
      for (const f of lab.crowd) {
        if (f.status === "safe") continue;
        ctx.beginPath();
        ctx.arc(px(f.x), pz(f.z), 4, 0, Math.PI * 2);
        ctx.fillStyle = f.status === "down" ? "#222" : "#d8d2dc";
        ctx.fill();
      }
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
  }, [gl, scene, camera, target, CAM, SHOT_H]);

  return null;
}

/* ------------------------------------------------------------------ spectator camera */

function Spectator({ plan: current }: { plan: Plan }) {
  const controls = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  // a new building: look at all of it from above and a little to the south
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const b = current.bounds;
    const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
    const cz = (b.minZ + b.maxZ) / 2;
    c.target.set((b.minX + b.maxX) / 2, 0, cz);
    c.object.position.set((b.minX + b.maxX) / 2, size * 1.1, cz + size * 0.85);
    c.update();
  }, [current]);
  const goal = useMemo(() => new THREE.Vector3(0, 0, -15), []);
  const eye = useMemo(() => new THREE.Vector3(), []);
  // when you pick someone, the camera swoops down behind their shoulder, then rides along
  const glide = useRef({ id: null as number | null, left: 0 });
  useFrame((_, rawDt) => {
    const follow = useSpectator.getState().follow;
    const agent = follow ? lab.agents.find((a) => a.id === follow) : null;
    const c = controls.current;
    const dt = clampDt(rawDt);
    if (follow !== glide.current.id) glide.current = { id: follow, left: agent ? 1.6 : 0 };
    if (!c || !agent) return;
    goal.set(agent.x, 0.9, agent.z);
    if (glide.current.left > 0) {
      glide.current.left -= dt;
      const k = Math.min(1, dt * 3.2);
      eye.set(agent.x - Math.sin(agent.heading) * 6, 4.2, agent.z - Math.cos(agent.heading) * 6);
      c.target.lerp(goal, k);
      c.object.position.lerp(eye, k);
      c.update();
      return;
    }
    const k = Math.min(1, dt * 3);
    const shift = goal.clone().sub(c.target).multiplyScalar(k);
    c.target.add(shift);
    c.object.position.add(shift);
    c.update();
  });
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      target={[0, 0, -15]}
      maxPolarAngle={1.35}
      minDistance={6}
      maxDistance={110}
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
  const current = usePlan((s) => s.plan)!;
  return (
    <Canvas
      shadows="percentage"
      dpr={typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches ? 1 : [1, 1.5]}
      camera={{ position: [0, 58, 30], fov: 45, near: 0.5, far: 400 }}
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
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-50}
          shadow-camera-right={50}
          shadow-camera-top={50}
          shadow-camera-bottom={-50}
          shadow-camera-far={160}
          shadow-bias={-0.0004}
        />
        <Physics key={current.id} paused>
          {current.demo ? (
            <>
              <Exterior />
              <Building />
              <Rooms />
            </>
          ) : (
            <DesignedBuilding plan={current} />
          )}
          <NavBuilder />
        </Physics>
        <StaticShadows key={`shadows-${current.id}`} />
        <People />
        <CrowdInstances />
        {current.demo && <WestSteps />}
        <HeatOverlay plan={current} />
        <Signposts key={`signs-${current.id}`} />
        <Fire />
        <SmokeHaze key={`smoke-${current.id}`} />
        <CCTV key={`cctv-${current.id}`} plan={current} />
        <Spectator plan={current} />
        <Loop />
      </Suspense>
    </Canvas>
  );
});
