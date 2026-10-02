"use client";

import { MARKERS, SCENARIO_OBJECTS, SPECTATOR_THREATS, nextScenarioGuidance, type MarkerDef, type ScenarioObjectDef } from "../level";
import { useSimulation, useSectorVisible } from "../store";
import { Label, MarkerOverlay } from "./Markers";
import { ExitSign } from "./Decor";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";

const byId = (id: string) => MARKERS.find((marker) => marker.id === id) as MarkerDef;

function EvidenceTarget({ def }: { def: MarkerDef }) {
  const [x, y, z] = def.position;
  const visible = useSectorVisible(def.room);
  const status = useSimulation((state) => state.evidence[def.id]?.status ?? "UNKNOWN");
  if (!visible) return null;
  return (
    <group>
      <mesh position={[x, y, z]} castShadow>
        <boxGeometry args={[0.5, 0.36, 0.3]} />
        <meshStandardMaterial
          color={status === "VERIFIED" ? "#10b981" : def.color}
          emissive={def.color}
          emissiveIntensity={0.25}
          roughness={0.65}
        />
      </mesh>
      <MarkerOverlay def={def} size={[0.8, 0.55, 0.55]} />
    </group>
  );
}

function VentilationPanel() {
  const def = byId("ventilation-panel");
  const [x, y, z] = def.position;
  const visible = useSectorVisible(def.room);
  const applied = useSimulation((state) => state.interventionApplied);
  if (!visible) return null;
  return (
    <group>
      <group position={[x, y, z]} rotation={[0, def.rotationY ?? 0, 0]}>
        <mesh castShadow>
          <boxGeometry args={[0.36, 0.58, 0.14]} />
          <meshStandardMaterial color={applied ? "#334155" : "#1e647e"} roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.11, 0.08]}>
          <sphereGeometry args={[0.07, 14, 14]} />
          <meshStandardMaterial
            color={applied ? "#10b981" : "#38bdf8"}
            emissive={applied ? "#10b981" : "#38bdf8"}
            emissiveIntensity={applied ? 0.4 : 1.4}
          />
        </mesh>
        <mesh position={[0, -0.13, 0.08]}>
          <boxGeometry args={[0.22, 0.13, 0.03]} />
          <meshStandardMaterial color="#e6e4de" />
        </mesh>
      </group>
      <MarkerOverlay def={def} size={[0.5, 0.72, 0.32]} />
    </group>
  );
}

function WestRouteSign() {
  const def = byId("west-route-sign");
  const [x, y, z] = def.position;
  const view = useSimulation((state) => state.view);
  const visible = useSectorVisible(def.room);
  if (!visible || view === "evacuee") return null;
  return (
    <group position={[x, y, z]}>
      <mesh>
        <boxGeometry args={[3, 0.7, 0.06]} />
        <meshStandardMaterial color="#17231e" roughness={0.6} />
      </mesh>
      <mesh position={[-0.7, 0, 0.04]}>
        <planeGeometry args={[1.1, 0.16]} />
        <meshBasicMaterial color="#10b981" />
      </mesh>
      <MarkerOverlay def={def} size={[3, 0.7, 0.12]} />
    </group>
  );
}

function ObjectiveBeacon({ def }: { def: ScenarioObjectDef }) {
  const ring = useRef<THREE.Mesh>(null);
  const [, y] = def.position;
  useFrame(({ clock }) => {
    if (!ring.current) return;
    const pulse = 0.88 + Math.sin(clock.elapsedTime * 4) * 0.12;
    ring.current.scale.setScalar(pulse);
    ring.current.rotation.z = clock.elapsedTime * 0.8;
  });
  return (
    <group>
      <mesh ref={ring} position={[0, -y + 0.035, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.52, 0.62, 32]} />
        <meshBasicMaterial color={def.color} transparent opacity={0.9} depthWrite={false} />
      </mesh>
      <Label position={[0, Math.max(1.9, y + 0.9) - y, 0]} color={def.color} text="NEXT OBJECTIVE" sub={def.label} />
    </group>
  );
}

function ScenarioProp({ def }: { def: ScenarioObjectDef }) {
  const visible = useSectorVisible(def.room);
  const complete = useSimulation((state) => state.scenarioProgress[def.id]);
  const nextId = useSimulation((state) => nextScenarioGuidance(state.scenarioProgress).id);
  const view = useSimulation((state) => state.view);
  const sector = useSimulation((state) => state.sector);
  if (!visible || (complete && def.id !== "main-exit")) return null;

  return (
    <group position={def.position}>
      {def.id === "emergency-backpack" && (
        <group rotation={[0, -0.2, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.48, 0.58, 0.24]} />
            <meshStandardMaterial color="#1d2630" roughness={0.8} />
          </mesh>
          <mesh position={[0, 0.08, 0.14]}>
            <boxGeometry args={[0.32, 0.2, 0.04]} />
            <meshStandardMaterial color="#2d3e4d" roughness={0.75} />
          </mesh>
          {[-1, 1].map((side) => (
            <mesh key={side} position={[side * 0.15, 0.05, 0.15]} rotation={[0, 0, side * 0.1]}>
              <boxGeometry args={[0.045, 0.5, 0.025]} />
              <meshStandardMaterial color="#38bdf8" emissive="#1e6b91" emissiveIntensity={0.7} />
            </mesh>
          ))}
        </group>
      )}
      {def.id === "lab-access-card" && (
        <group rotation={[0.1, 0, -0.2]}>
          <mesh castShadow>
            <boxGeometry args={[0.18, 0.28, 0.025]} />
            <meshStandardMaterial color="#facc15" emissive="#765b00" emissiveIntensity={0.4} />
          </mesh>
          <mesh position={[0, 0.03, 0.02]}>
            <boxGeometry args={[0.11, 0.025, 0.01]} />
            <meshBasicMaterial color="#fff7c2" />
          </mesh>
        </group>
      )}
      {def.id === "gas-valve" && (
        <group rotation={[Math.PI / 2, 0, 0]}>
          <mesh castShadow>
            <torusGeometry args={[0.22, 0.045, 8, 16]} />
            <meshStandardMaterial color="#ef4444" emissive="#7f1d1d" emissiveIntensity={0.5} metalness={0.45} />
          </mesh>
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <boxGeometry args={[0.05, 0.5, 0.05]} />
            <meshStandardMaterial color="#d6d3d1" metalness={0.65} roughness={0.35} />
          </mesh>
        </group>
      )}
      {def.id === "first-aid-kit" && (
        <group>
          <mesh castShadow>
            <boxGeometry args={[0.42, 0.28, 0.28]} />
            <meshStandardMaterial color="#e9edf0" roughness={0.45} />
          </mesh>
          <mesh position={[0, 0.01, 0.145]}>
            <boxGeometry args={[0.11, 0.19, 0.015]} />
            <meshBasicMaterial color="#ef4444" />
          </mesh>
          <mesh position={[0, 0.01, 0.155]}>
            <boxGeometry args={[0.19, 0.08, 0.015]} />
            <meshBasicMaterial color="#ef4444" />
          </mesh>
        </group>
      )}
      {(def.id === "lab-safety-clue" || def.id === "academic-guide") && (
        <group rotation={[0.1, 0.15, def.id === "academic-guide" ? -0.12 : 0.12]}>
          <mesh castShadow>
            <boxGeometry args={[0.42, 0.035, 0.3]} />
            <meshStandardMaterial color={def.id === "academic-guide" ? "#a78bfa" : "#10b981"} roughness={0.8} />
          </mesh>
          <mesh position={[0, 0.022, 0]}>
            <boxGeometry args={[0.3, 0.006, 0.02]} />
            <meshBasicMaterial color="#f8fafc" />
          </mesh>
        </group>
      )}
      {def.id === "main-exit" && (
        <group position={[0, -def.position[1], 0]}>
          {/* green frame around the entrance doors and a strip on the floor leading out */}
          {[-1.5, 1.5].map((x) => (
            <mesh key={x} position={[x, 1.3, -0.12]}>
              <boxGeometry args={[0.08, 2.6, 0.08]} />
              <meshBasicMaterial color="#2fd18f" toneMapped={false} />
            </mesh>
          ))}
          <mesh position={[0, 2.6, -0.12]}>
            <boxGeometry args={[3.08, 0.08, 0.08]} />
            <meshBasicMaterial color="#2fd18f" toneMapped={false} />
          </mesh>
          <mesh position={[0, 0.02, -0.9]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[2.6, 1.2]} />
            <meshBasicMaterial color="#2fd18f" transparent opacity={complete ? 0.15 : 0.32} depthWrite={false} />
          </mesh>
          {view !== "evacuee" && <ExitSign position={[0, 2.95, 0.05]} rotationY={Math.PI} />}
        </group>
      )}
      {view === "evacuee" && sector === def.room && nextId === def.id && <ObjectiveBeacon def={def} />}
    </group>
  );
}

function SpectatorThreats() {
  const view = useSimulation((state) => state.view);
  const visible = useSimulation((state) => state.mode.kind === "warden" || view === "evidence");
  if (!visible) return null;
  return (
    <>
      {SPECTATOR_THREATS.map((threat) => (
        <ThreatMarker key={threat.id} threat={threat} />
      ))}
    </>
  );
}

function ThreatMarker({ threat }: { threat: (typeof SPECTATOR_THREATS)[number] }) {
  const ring = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ring.current) return;
    ring.current.rotation.y = clock.elapsedTime * 0.8;
    ring.current.scale.setScalar(0.9 + Math.sin(clock.elapsedTime * 3) * 0.12);
  });
  return (
    <group position={threat.position}>
      {threat.id === "gas-cloud" ? (
        <group>
          {[0, 1, 2, 3].map((index) => (
            <mesh key={index} position={[Math.sin(index * 2) * 0.22, index * 0.12, Math.cos(index) * 0.18]}>
              <sphereGeometry args={[0.18 + index * 0.035, 12, 10]} />
              <meshBasicMaterial color="#ef4444" transparent opacity={0.12} depthWrite={false} />
            </mesh>
          ))}
        </group>
      ) : (
        <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.72, 0.035, 8, 24]} />
          <meshBasicMaterial color={threat.color} transparent opacity={0.85} />
        </mesh>
      )}
      <Label position={[0, 0.9, 0]} color={threat.color} text={threat.label} room={threat.room} />
    </group>
  );
}

export default function Interactables() {
  return (
    <>
      {MARKERS.filter((marker) => marker.kind === "evidence").map((marker) => (
        <EvidenceTarget key={marker.id} def={marker} />
      ))}
      <VentilationPanel />
      <WestRouteSign />
      {SCENARIO_OBJECTS.map((object) => (
        <ScenarioProp key={object.id} def={object} />
      ))}
      <SpectatorThreats />
    </>
  );
}
