"use client";

import { useEffect, useRef } from "react";
import { ASSEMBLY_Z, ROOMS, nextScenarioGuidance, roomById, scenarioObjectById, type RoomId } from "../level";
import { runtime } from "../runtime";
import { useSimulation } from "../store";

const MIN_X = -23.5;
const MAX_X = 23.5;
const MIN_Z = -26.5;
const MAX_Z = 19;
const W = MAX_X - MIN_X;
const H = MAX_Z - MIN_Z;
const sx = (x: number) => x - MIN_X;
const sy = (z: number) => z - MIN_Z;

const PLAN: RoomId[] = ["library", "atrium", "cafe", "sec", "wcorr", "lobby", "ecorr", "vault", "entry", "annex"];
const SHORT: Partial<Record<RoomId, string>> = {
  sec: "LAB 1A",
  lobby: "CORRIDOR",
  vault: "A201",
  entry: "ENTRANCE",
  annex: "SVC",
  atrium: "HALL",
  library: "LIBRARY",
  cafe: "CAFE",
};
const EXIT = scenarioObjectById("main-exit").position;

/**
 * Lightweight floorplan layer; the 3D scene remains the only world view. `compact` is the
 * phone version: the plan alone, smaller, with no title or key.
 */
export default function Minimap({ compact = false }: { compact?: boolean }) {
  const mode = useSimulation((state) => state.mode);
  const sector = useSimulation((state) => state.sector);
  const progress = useSimulation((state) => state.scenarioProgress);
  const assignedSector = mode.kind === "warden" ? mode.sectorId : null;
  const guidance = nextScenarioGuidance(progress);
  const objective =
    guidance.id !== "complete" && guidance.id !== "main-exit" ? scenarioObjectById(guidance.id).position : null;
  const you = useRef<SVGGElement>(null);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (time: number) => {
      raf = requestAnimationFrame(tick);
      if (time - last < 50 || !you.current) return;
      last = time;
      const degrees = (-runtime.evacueeYaw * 180) / Math.PI;
      you.current.setAttribute(
        "transform",
        `translate(${sx(runtime.evacuee.x).toFixed(2)} ${sy(runtime.evacuee.z).toFixed(2)}) rotate(${degrees.toFixed(1)})`,
      );
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className={`hud-panel hud-panel-blue ${compact ? "p-1.5" : "p-2.5"}`}>
      <div className={`mb-1.5 ${compact ? "hidden" : "flex"} items-center justify-between gap-3 text-[9px] font-black uppercase tracking-[0.18em]`}>
        <span className="text-paper">Science Block · L1</span>
        <span className="truncate text-paper/50">{roomById(sector).name.split(" / ").pop()}</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={compact ? "block h-[78px] w-[80px] overflow-visible" : "block h-[92px] w-[94px] overflow-visible sm:h-[150px] sm:w-[154px]"}
        role="img"
        aria-label="Floorplan with your position, the next objective and the exit"
      >
        <rect x={sx(-14)} y={sy(10.5)} width={28} height={8.5} fill="rgba(47,209,143,0.08)" stroke="rgba(248,242,234,0.15)" strokeWidth={0.2} />
        {PLAN.map((id) => {
          const bounds = ROOMS.find((item) => item.id === id)!.bounds;
          const current = sector === id;
          const assigned = assignedSector === id;
          return (
            <g key={id}>
              <rect
                x={sx(bounds.minX)}
                y={sy(bounds.minZ)}
                width={bounds.maxX - bounds.minX}
                height={bounds.maxZ - bounds.minZ}
                fill={current ? "rgba(255,196,77,0.18)" : assigned ? "rgba(47,209,143,0.14)" : "rgba(248,242,234,0.06)"}
                stroke={current ? "#ffc44d" : assigned ? "#2fd18f" : "rgba(248,242,234,0.3)"}
                strokeWidth={current || assigned ? 0.45 : 0.25}
              />
              {SHORT[id] && (
                <text
                  x={sx((bounds.minX + bounds.maxX) / 2)}
                  y={sy((bounds.minZ + bounds.maxZ) / 2)}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={current ? "#ffe3a3" : "rgba(248,242,234,0.55)"}
                  fontSize={id === "annex" || id === "entry" ? 1.3 : 1.9}
                  fontFamily="var(--font-geist-mono), monospace"
                  fontWeight="700"
                >
                  {SHORT[id]}
                </text>
              )}
            </g>
          );
        })}
        <circle cx={sx(0)} cy={sy(ASSEMBLY_Z + 2)} r={1.8} fill="none" stroke="#2fd18f" strokeWidth={0.3} strokeDasharray="0.7 0.5" />
        <rect x={sx(EXIT[0]) - 1.1} y={sy(EXIT[2]) - 1.1} width={2.2} height={2.2} fill="#2fd18f" stroke="#16111e" strokeWidth={0.3} />
        {objective && (
          <g transform={`translate(${sx(objective[0])} ${sy(objective[2])})`}>
            <circle r={2.3} fill="none" stroke="#ff6a3d" strokeWidth={0.35} className="signal-pulse" style={{ transformBox: "fill-box", transformOrigin: "center" }} />
            <path d="M0 -1.35 L1.35 0 L0 1.35 L-1.35 0 Z" fill="#ff6a3d" stroke="#16111e" strokeWidth={0.25} />
          </g>
        )}
        <g ref={you} transform={`translate(${sx(0)} ${sy(9)})`}>
          <path d="M0 1.9 L1.25 -1.1 L0 -0.45 L-1.25 -1.1 Z" fill="#ffc44d" stroke="#16111e" strokeWidth={0.3} />
        </g>
      </svg>
      <div className={`mt-1.5 flex-wrap ${compact ? "hidden" : "flex"} gap-x-3 gap-y-1 text-[9px] font-bold uppercase tracking-wider text-paper/65`}>
        <span className="flex items-center gap-1">
          <i className="inline-block h-0 w-0 border-x-[4px] border-t-[7px] border-x-transparent border-t-sun" />
          {mode.kind === "warden" ? "Evacuee" : "You"}
        </span>
        <span className="flex items-center gap-1">
          <i className="inline-block h-2 w-2 rotate-45 bg-coral" />
          Objective
        </span>
        <span className="flex items-center gap-1">
          <i className="inline-block h-2 w-2 bg-mint" />
          Exit
        </span>
        {assignedSector && <span className="text-mint">Your sector</span>}
      </div>
    </div>
  );
}
