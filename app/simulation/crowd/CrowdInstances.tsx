"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { lab } from "./engine";

/**
 * Everyone who is not an AI person, drawn as one crowd: two instanced meshes (bodies and
 * heads) for any number of people, so three hundred students cost two draw calls. Each person
 * walks with a small bob, crawls low under smoke, lies down if they collapse, and fades to a
 * dimmer colour once safe outside.
 */

const MAX = 600;
const SHIRTS = ["#5b7fbf", "#c76b5b", "#6aa36f", "#c9a35b", "#8e6bb8", "#5ba3a3", "#b85b8e", "#7f7f8f"].map((c) => new THREE.Color(c));
const SKIN = ["#f1c9a5", "#e0ac69", "#c68642", "#8d5524", "#5c3a21"].map((c) => new THREE.Color(c));
const DOWN = new THREE.Color("#4a4550");

export default function CrowdInstances() {
  const bodies = useRef<THREE.InstancedMesh>(null);
  const heads = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => ({ body: new THREE.CapsuleGeometry(0.2, 0.75, 4, 8), head: new THREE.SphereGeometry(0.13, 10, 8) }), []);
  const mats = useMemo(() => ({ body: new THREE.MeshStandardMaterial({ roughness: 0.8 }), head: new THREE.MeshStandardMaterial({ roughness: 0.6 }) }), []);
  const scratch = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler(), p: new THREE.Vector3(), s: new THREE.Vector3(1.15, 1.15, 1.15), c: new THREE.Color() }), []);

  // give every instance a colour before the first draw, so the shader is built with per-person colours
  useLayoutEffect(() => {
    for (let i = 0; i < MAX; i++) {
      bodies.current?.setColorAt(i, SHIRTS[i % SHIRTS.length]);
      heads.current?.setColorAt(i, SKIN[i % SKIN.length]);
    }
  }, []);

  useFrame(({ clock }) => {
    const b = bodies.current;
    const h = heads.current;
    if (!b || !h) return;
    const crowd = lab.crowd;
    const n = Math.min(crowd.length, MAX);
    const { m, q, e, p, s, c } = scratch;
    const time = clock.elapsedTime;
    for (let i = 0; i < n; i++) {
      const f = crowd[i];
      const down = f.status === "down";
      const crawling = (f.crawl || f.sheltering) && f.status === "inside";
      const moving = f.status === "inside" && !!f.path;
      const bob = moving && !crawling ? Math.abs(Math.sin(time * 8 + i)) * 0.05 : 0;
      // body: upright, pitched forward and low when crawling, flat when down
      e.set(down ? Math.PI / 2 : crawling ? 1.2 : 0, f.heading, 0, "YXZ");
      q.setFromEuler(e);
      p.set(f.x, down ? 0.25 : crawling ? 0.45 : 0.69 + bob, f.z);
      m.compose(p, q, s);
      b.setMatrixAt(i, m);
      c.copy(down ? DOWN : SHIRTS[f.id % SHIRTS.length]);
      if (f.status === "safe") c.multiplyScalar(0.55);
      b.setColorAt(i, c);
      // head: on top of the body, or ahead of it when crawling or lying
      const forward = down ? 0.65 : crawling ? 0.55 : 0;
      p.set(f.x + Math.sin(f.heading) * forward, down ? 0.23 : crawling ? 0.62 : 1.36 + bob, f.z + Math.cos(f.heading) * forward);
      m.compose(p, q.identity(), s);
      h.setMatrixAt(i, m);
      h.setColorAt(i, SKIN[f.id % SKIN.length]);
    }
    b.count = n;
    h.count = n;
    b.instanceMatrix.needsUpdate = true;
    h.instanceMatrix.needsUpdate = true;
    if (b.instanceColor) b.instanceColor.needsUpdate = true;
    if (h.instanceColor) h.instanceColor.needsUpdate = true;
  });

  return (
    <>
      <instancedMesh ref={bodies} args={[geo.body, mats.body, MAX]} frustumCulled={false} />
      <instancedMesh ref={heads} args={[geo.head, mats.head, MAX]} frustumCulled={false} />
    </>
  );
}
