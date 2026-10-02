"use client";

import { useRef, useState } from "react";
import { Html, Edges } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { isRevealed, type MarkerDef, type RoomId, type Vec3 } from "../level";
import { useSimulation, useSectorVisible } from "../store";

/**
 * Screen-space neon chip, same language as the reference mock.
 *
 * Given a `room`, the chip only shows while the evacuee is in that room: the overhead
 * views follow the evacuee, so a label anywhere else is clutter - and each one is a DOM
 * node repositioned every frame.
 */
export function Label({
  position,
  color,
  text,
  sub,
  faint = false,
  room,
}: {
  position: Vec3;
  color: string;
  text: string;
  sub?: string;
  faint?: boolean;
  room?: RoomId;
}) {
  const hidden = useSimulation((s) => room !== undefined && s.sector !== room);
  if (hidden) return null;
  return (
    <Html
      position={position}
      center
      zIndexRange={[9, 0]}
      style={{ pointerEvents: "none", userSelect: "none" }}
    >
      <div
        style={{
          whiteSpace: "nowrap",
          fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
          fontSize: 11,
          lineHeight: 1.15,
          fontWeight: 800,
          letterSpacing: 0.3,
          textTransform: "uppercase",
          color,
          background: "rgba(22,17,30,0.9)",
          border: `2px solid ${color}`,
          borderRadius: 0,
          padding: "3px 8px",
          opacity: faint ? 0.55 : 1,
          boxShadow: `3px 3px 0 ${color}`,
        }}
      >
        {text}
        {sub ? (
          <div
            style={{
              fontSize: 9,
              fontWeight: 500,
              opacity: 0.75,
              letterSpacing: 0.1,
            }}
          >
            {sub}
          </div>
        ) : null}
      </div>
    </Html>
  );
}

/** Glowing wireframe volume drawn around a physical prop. */
export function NeonBox({
  position,
  rotation = [0, 0, 0],
  size,
  color,
  opacity = 0.1,
  pulse = false,
}: {
  position: Vec3;
  rotation?: Vec3;
  size: Vec3;
  color: string;
  opacity?: number;
  pulse?: boolean;
}) {
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (pulse && mat.current)
      mat.current.opacity =
        opacity * (0.55 + 0.45 * Math.sin(clock.elapsedTime * 3));
  });
  return (
    <mesh position={position} rotation={rotation} renderOrder={2}>
      <boxGeometry args={size} />
      <meshBasicMaterial
        ref={mat}
        color={color}
        transparent
        opacity={opacity}
        depthWrite={false}
      />
      <Edges color={color} lineWidth={2} />
    </mesh>
  );
}

/** The clickable evidence target used in evidence review. */
function Blip({
  position,
  color,
  onClick,
}: {
  position: Vec3;
  color: string;
  onClick: () => void;
}) {
  const ring = useRef<THREE.Mesh>(null);
  const core = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);

  useFrame(({ clock, camera }) => {
    const t = (clock.elapsedTime % 1.6) / 1.6;
    if (ring.current) {
      ring.current.scale.setScalar(0.35 + t * 1.1);
      (ring.current.material as THREE.MeshBasicMaterial).opacity =
        (1 - t) * 0.7;
      ring.current.quaternion.copy(camera.quaternion);
    }
    if (core.current)
      core.current.scale.setScalar(
        (hovered ? 1.35 : 1) *
          (0.9 + 0.1 * Math.sin(clock.elapsedTime * 5)),
      );
  });

  return (
    <group position={position}>
      {/* generous invisible hit area - the visible dot is tiny */}
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHovered(false);
          document.body.style.cursor = "auto";
        }}
      >
        <sphereGeometry args={[0.45, 12, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh ref={core} renderOrder={3} raycast={() => null}>
        <sphereGeometry args={[0.16, 16, 16]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.9}
          depthTest={false}
        />
      </mesh>
      <mesh ref={ring} renderOrder={3}>
        <ringGeometry args={[0.24, 0.3, 32]} />
        <meshBasicMaterial
          color={color}
          transparent
          side={THREE.DoubleSide}
          depthTest={false}
        />
      </mesh>
      <Html
        position={[0, 0.42, 0]}
        center
        zIndexRange={[9, 0]}
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        <div
          style={{
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 10,
            fontWeight: 700,
            color,
            border: `1px dashed ${color}`,
            borderRadius: 4,
            padding: "2px 6px",
            background: "rgba(8,12,18,0.7)",
            opacity: hovered ? 1 : 0.8,
          }}
        >
          ? inspect
        </div>
      </Html>
    </group>
  );
}

interface MarkerViewState {
  /** Fully revealed: neon outline and label. */
  revealed: boolean;
  /** Unobserved evidence in the evidence view. */
  pending: boolean;
  inspect: () => void;
}

function useMarker(def: MarkerDef): MarkerViewState {
  const view = useSimulation((s) => s.view);
  const evidence = useSimulation((s) => s.evidence[def.id]);
  const observed = evidence?.status !== undefined && evidence.status !== "UNKNOWN";
  const visible = useSectorVisible(def.room);
  const revealed = visible && isRevealed(def.reveal, view, observed);
  return {
    revealed,
    pending:
      visible &&
      view === "evidence" &&
      def.kind === "evidence" &&
      !observed,
    inspect: () => {
      const event = new CustomEvent("inspect-evidence", {
        detail: {
          id: def.id,
          label: def.label,
          sectorId: def.room,
          source: def.source ?? "Authored sector evidence",
          nextAction: def.nextAction ?? "Inspect and verify the evidence.",
        },
      });
      window.dispatchEvent(event);
    },
  };
}

/**
 * Standard overlay for a prop: neon volume and chip when visible, clickable
 * evidence blip before it is observed.
 */
export function MarkerOverlay({
  def,
  size,
  rotation,
  center,
}: {
  def: MarkerDef;
  size: Vec3;
  rotation?: Vec3;
  center?: Vec3;
}) {
  const { revealed, pending, inspect } = useMarker(def);
  const p = center ?? def.position;
  const lo = def.labelOffset ?? [0, 0.7, 0];

  if (pending)
    return (
      <Blip
        position={[p[0], p[1] + 0.25, p[2]]}
        color={def.color}
        onClick={inspect}
      />
    );

  if (!revealed) return null;

  return (
    <>
      <NeonBox position={p} rotation={rotation} size={size} color={def.color} />
      <Label
        position={[p[0] + lo[0], p[1] + lo[1], p[2] + lo[2]]}
        color={def.color}
        text={def.label}
        sub={def.sub}
        room={def.room}
      />
    </>
  );
}
