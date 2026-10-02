"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useKeyboardControls } from "@react-three/drei";
import { CapsuleCollider, RigidBody, useRapier, type RapierRigidBody } from "@react-three/rapier";
import * as THREE from "three";
import { ceilingAt, EVACUEE_SPAWN, roomAt } from "../level";
import { pressJump, pressUse } from "../controls";
import { clampDt, runtime } from "../runtime";
import { useSimulation, useIsSimulationOwner } from "../store";
import { Label, NeonBox } from "./Markers";
import Student from "./Student";

type Controls =
  | "forward"
  | "back"
  | "left"
  | "right"
  | "sprint"
  | "use"
  | "jump"
  | "camera";

const WALK = 3.8;
const RUN = 6.4;
/** A full push on the phone stick walks a little slower than W does: thumbs overshoot. */
const TOUCH_WALK = 3.1;
const JUMP_V = 6.2;
const JUMP_BUFFER_MS = 160;
/** A jump pressed just after walking off an edge still counts. */
const COYOTE_MS = 120;
const EYE = 0.8;

/* Speed eases in and out instead of snapping, so starts, stops and turns carry a little weight. */
const ACCEL = 14;
const BRAKE = 18;
const AIR_CONTROL = 4;
/** Capsule centre to sole (half height + radius), plus a little slack for steps and slopes. */
const FOOT_RAY = 0.82 + 0.12;

/* camera feel for the evacuee's own view */
const BASE_FOV = 74;
const SPRINT_FOV = 82;
const STRAFE_ROLL = 0.022;

/* over-the-shoulder camera, measured from the body's centre */
const SHOULDER_HEIGHT = 0.9;
const SHOULDER_OFFSET = 0.5;
const CAMERA_DISTANCE = 2.4;
const CAMERA_CLEARANCE = 0.2;
const UP = new THREE.Vector3(0, 1, 0);

function HeadingBeacon() {
  return (
    <group position={[0, 2.35, 0]}>
      <mesh position={[0, 0, 0.27]}>
        <boxGeometry args={[0.045, 0.045, 0.48]} />
        <meshBasicMaterial color="#facc15" />
      </mesh>
      <mesh position={[0, 0, 0.62]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.14, 0.28, 4]} />
        <meshBasicMaterial color="#facc15" />
      </mesh>
    </group>
  );
}

function ContactShade() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
      <circleGeometry args={[0.5, 20]} />
      <meshBasicMaterial color="#05070a" transparent opacity={0.3} />
    </mesh>
  );
}

function LocalEvacuee() {
  const body = useRef<RapierRigidBody>(null);
  const visual = useRef<THREE.Group>(null);
  const eyeTarget = useRef(new THREE.Vector3());
  const bobT = useRef(0);
  const feel = useRef({ groundedAt: 0, wasGrounded: true, landDip: 0, roll: 0, sway: 0 });
  const [sub, get] = useKeyboardControls<Controls>();
  const { world, rapier } = useRapier();
  const scratch = useMemo(
    () => ({
      look: new THREE.Vector3(),
      right: new THREE.Vector3(),
      head: new THREE.Vector3(),
      back: new THREE.Vector3(),
      target: new THREE.Vector3(),
      down: new THREE.Vector3(0, -1, 0),
      foot: new THREE.Vector3(),
      want: new THREE.Vector3(),
      euler: new THREE.Euler(0, 0, 0, "YXZ"),
    }),
    [],
  );
  const view = useSimulation((state) => state.view);
  const cameraMode = useSimulation((state) => state.cameraMode);
  const hasBackpack = useSimulation((state) => state.hasBackpack);
  const equipped = useSimulation((state) => state.equipped);
  // a yes/no, not the value: air changes every hazard tick and would re-render the body
  const alive = useSimulation((state) => state.air > 0);
  const briefingStatus = useSimulation((state) => state.briefingStatus);
  const paused = useSimulation((state) => state.paused);
  const resetSeq = useSimulation((state) => state.resetSeq);
  // the evacuee's own camera: over the right shoulder, or through the eyes
  const ownCamera = view === "evacuee";
  const eyes = ownCamera && cameraMode === "first";
  const overShoulder = ownCamera && cameraMode === "third";

  useEffect(
    () =>
      sub(
        (state) => state.use,
        (pressed) => pressed && pressUse(),
      ),
    [sub],
  );

  useEffect(
    () =>
      sub(
        (state) => state.jump,
        (pressed) => pressed && pressJump(),
      ),
    [sub],
  );

  useEffect(
    () =>
      sub(
        (state) => state.camera,
        (pressed) => pressed && useSimulation.getState().toggleCameraMode(),
      ),
    [sub],
  );

  useEffect(() => {
    const rb = body.current;
    if (!rb) return;
    rb.setTranslation(
      { x: EVACUEE_SPAWN[0], y: EVACUEE_SPAWN[1], z: EVACUEE_SPAWN[2] },
      true,
    );
    rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
    eyeTarget.current.set(EVACUEE_SPAWN[0], EVACUEE_SPAWN[1] + EYE, EVACUEE_SPAWN[2]);
  }, [resetSeq]);

  useFrame((state, rawDt) => {
    const rb = body.current;
    if (!rb) return;
    const dt = clampDt(rawDt);
    const t = rb.translation();
    runtime.evacuee.set(t.x, t.y, t.z);
    runtime.sector = roomAt(t.x, t.z);

    const movementEnabled = briefingStatus === "complete" && !paused;
    const down = movementEnabled && alive ? get() : ({} as Record<Controls, boolean>);
    const stick = movementEnabled && alive ? runtime.touchMove : { x: 0, y: 0 };
    const forward = THREE.MathUtils.clamp(
      (down.forward ? 1 : 0) - (down.back ? 1 : 0) + stick.y,
      -1,
      1,
    );
    const right = THREE.MathUtils.clamp(
      (down.right ? 1 : 0) - (down.left ? 1 : 0) + stick.x,
      -1,
      1,
    );

    const direction = state.camera.getWorldDirection(new THREE.Vector3());
    direction.y = 0;
    if (direction.lengthSq() < 1e-6) direction.set(0, 0, -1);
    direction.normalize();
    const side = new THREE.Vector3().crossVectors(
      direction,
      new THREE.Vector3(0, 1, 0),
    );
    const move = new THREE.Vector3()
      .addScaledVector(direction, forward)
      .addScaledVector(side, right);
    const moving = move.lengthSq() > 1e-4;
    const throttle = Math.min(1, move.length());
    if (moving) move.normalize();

    // keyboard and thumb feed the same flag, so sprinting behaves identically on both
    const sprinting = (down.sprint || runtime.touchSprint) && moving;
    const thumb = !down.forward && !down.back && !down.left && !down.right && (stick.x !== 0 || stick.y !== 0);
    const speed = (sprinting ? RUN : thumb ? TOUCH_WALK : WALK) * (moving ? throttle : 0);
    const velocity = rb.linvel();
    const now = performance.now();

    // Stand on whatever is underfoot - floor, crate or bench - rather than a fixed height.
    const footHit = world.castRayAndGetNormal(
      new rapier.Ray(scratch.foot.set(t.x, t.y, t.z), scratch.down),
      FOOT_RAY,
      true,
      undefined,
      undefined,
      undefined,
      rb,
    );
    // rising faster than a stair climb means a jump is still under way
    const grounded = !!footHit && velocity.y < 4 && footHit.normal.y > 0.6;
    const f = feel.current;
    if (grounded) f.groundedAt = now;
    if (grounded && !f.wasGrounded && velocity.y < -3.5) f.landDip = Math.min(0.2, -velocity.y * 0.022);
    f.wasGrounded = grounded;
    const canJump = now - f.groundedAt < COYOTE_MS;

    const wantsJump = movementEnabled && now - runtime.jumpAt < JUMP_BUFFER_MS;
    const jumping = wantsJump && canJump && alive;
    if (jumping) {
      runtime.jumpAt = -1e9;
      f.groundedAt = 0;
    }

    const rate = grounded ? (moving ? ACCEL : BRAKE) : AIR_CONTROL;
    const k = 1 - Math.exp(-rate * dt);
    if (grounded && footHit && !jumping) {
      // On the ground, walk along the surface and switch gravity off: the body is frictionless,
      // so gravity would otherwise slide it back down the stair whenever the player stops.
      const n = footHit.normal;
      const want = scratch.want.set(move.x * speed, 0, move.z * speed);
      want.y = -(want.x * n.x + want.z * n.z) / n.y;
      // a little downward pull when the feet lift off the surface, e.g. cresting the stair
      const snap = footHit.timeOfImpact > 0.86 ? -1.5 : 0;
      rb.setGravityScale(0, true);
      rb.setLinvel(
        {
          x: velocity.x + (want.x - velocity.x) * k,
          y: velocity.y + (want.y + snap - velocity.y) * k,
          z: velocity.z + (want.z - velocity.z) * k,
        },
        true,
      );
    } else {
      rb.setGravityScale(1, true);
      rb.setLinvel(
        {
          x: velocity.x + (move.x * speed - velocity.x) * k,
          y: jumping ? JUMP_V : velocity.y,
          z: velocity.z + (move.z * speed - velocity.z) * k,
        },
        true,
      );
    }
    const planar = Math.hypot(velocity.x, velocity.z);
    const pace = Math.min(1, planar / RUN);

    // with its own camera the body faces where the player looks; otherwise where it walks
    if (ownCamera) runtime.evacueeYaw = Math.atan2(direction.x, direction.z);
    else if (moving) runtime.evacueeYaw = Math.atan2(move.x, move.z);
    if (visual.current) visual.current.rotation.y = runtime.evacueeYaw;
    bobT.current += grounded ? dt * (4 + planar * 1.55) : 0;

    if (ownCamera) {
      // Sprinting widens the view a touch; a hard landing dips it; strafing leans it.
      const camera = state.camera as THREE.PerspectiveCamera;
      const fov = THREE.MathUtils.lerp(BASE_FOV, SPRINT_FOV, sprinting && planar > WALK + 0.4 ? pace : 0);
      const nextFov = camera.fov + (fov - camera.fov) * (1 - Math.exp(-dt * 6));
      if (Math.abs(nextFov - camera.fov) > 0.01) {
        camera.fov = nextFov;
        camera.updateProjectionMatrix();
      }
      f.landDip += (0 - f.landDip) * (1 - Math.exp(-dt * 7));
      f.roll += (-right * STRAFE_ROLL * (moving ? 1 : 0) - f.roll) * (1 - Math.exp(-dt * 6));
      const euler = scratch.euler.setFromQuaternion(camera.quaternion);
      camera.quaternion.setFromEuler(euler.set(euler.x, euler.y, f.roll, "YXZ"));
    }

    const bobAmount = grounded ? pace : 0;
    f.sway += (bobAmount - f.sway) * (1 - Math.exp(-dt * 8));
    const bobY = Math.sin(bobT.current * 2) * 0.045 * f.sway - f.landDip;

    if (eyes) {
      const lateral = Math.sin(bobT.current) * 0.03 * f.sway;
      const side = scratch.right.crossVectors(direction, UP).normalize();
      eyeTarget.current.set(t.x + side.x * lateral, t.y + EYE + bobY, t.z + side.z * lateral);
      state.camera.position.lerp(eyeTarget.current, 1 - Math.exp(-dt * 18));
    } else if (overShoulder) {
      // Behind and right of the head, pulled in wherever a wall or the floor would clip it.
      const look = state.camera.getWorldDirection(scratch.look);
      const right = scratch.right.crossVectors(look, UP);
      if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
      right.normalize();
      const head = scratch.head.set(t.x, t.y + SHOULDER_HEIGHT + bobY * 0.5, t.z);
      const sideHit = world.castRay(
        new rapier.Ray(head, right),
        SHOULDER_OFFSET,
        true,
        undefined,
        undefined,
        undefined,
        rb,
      );
      head.addScaledVector(
        right,
        sideHit ? Math.max(0, sideHit.timeOfImpact - CAMERA_CLEARANCE) : SHOULDER_OFFSET,
      );
      const back = scratch.back.copy(look).negate();
      // pull back a little further at a sprint so the speed reads
      const reach = CAMERA_DISTANCE + pace * 0.35;
      const backHit = world.castRay(
        new rapier.Ray(head, back),
        reach,
        true,
        undefined,
        undefined,
        undefined,
        rb,
      );
      const distance = backHit
        ? Math.max(0.35, backHit.timeOfImpact - CAMERA_CLEARANCE)
        : reach;
      const target = scratch.target.copy(head).addScaledVector(back, distance);
      // ceilings have no collider, so keep the camera under them indoors
      if (runtime.sector !== "outside") target.y = Math.min(target.y, ceilingAt(runtime.sector, t.z, t.y - 0.82) - 0.3);
      state.camera.position.lerp(target, 1 - Math.exp(-dt * 18));
    }
  });

  return (
    <RigidBody
      ref={body}
      type="dynamic"
      colliders={false}
      position={EVACUEE_SPAWN}
      enabledRotations={[false, false, false]}
      friction={0}
      linearDamping={0.4}
      mass={1}
      ccd
      userData={{ tag: "evacuee" }}
    >
      <CapsuleCollider args={[0.5, 0.32] as [number, number]} />
      <group ref={visual} position={[0, -0.85, 0]} visible={!eyes}>
        <Student hasBackpack={hasBackpack} heldItem={equipped} />
        <ContactShade />
        {!ownCamera && <HeadingBeacon />}
      </group>
      {!ownCamera && (
        <group position={[0, 0, 0]}>
          <NeonBox
            position={[0, 0.95, 0]}
            size={[0.85, 1.9, 0.55]}
            color={!alive ? "#ef4444" : "#38bdf8"}
            opacity={0.07}
          />
          <Label
            position={[0, 2.25, 0]}
            color={!alive ? "#ef4444" : "#38bdf8"}
            text={!alive ? "Evacuee (down)" : "Evacuee"}
          />
        </group>
      )}
    </RigidBody>
  );
}

function RemoteEvacuee() {
  const group = useRef<THREE.Group>(null);
  const hasBackpack = useSimulation((state) => state.hasBackpack);
  const equipped = useSimulation((state) => state.equipped);
  useFrame((_, rawDt) => {
    const current = runtime.netEvacuee;
    const target = group.current;
    if (!target) return;
    target.visible = !!current;
    if (!current) return;
    const factor = Math.min(1, clampDt(rawDt) * 9);
    runtime.evacuee.lerp(new THREE.Vector3(current.x, current.y, current.z), factor);
    runtime.evacueeYaw +=
      (((current.yaw - runtime.evacueeYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * factor;
    target.position.set(runtime.evacuee.x, runtime.evacuee.y - 0.85, runtime.evacuee.z);
    target.rotation.y = runtime.evacueeYaw;
  });

  return (
    <group ref={group} visible={false}>
      <Student hasBackpack={hasBackpack} heldItem={equipped} />
      <ContactShade />
      <HeadingBeacon />
      <NeonBox position={[0, 0.95, 0]} size={[0.85, 1.9, 0.55]} color="#38bdf8" opacity={0.07} />
      <Label position={[0, 2.25, 0]} color="#38bdf8" text="Evacuee" />

    </group>
  );
}

export default function Evacuee() {
  const ownsSimulation = useIsSimulationOwner();
  return ownsSimulation ? <LocalEvacuee /> : <RemoteEvacuee />;
}
