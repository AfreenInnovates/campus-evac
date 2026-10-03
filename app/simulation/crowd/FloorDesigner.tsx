"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { DEFAULT_SPEC, LIMITS, peopleIn, planFor, presetRooms, ROOM_KINDS, roomsOf, type BuildingSpec, type RoomEntry, type RoomKind } from "./floorplan";
import { DEMO_PLAN, setPlan, type Plan } from "./world";

/**
 * Design your own floor: a few choices, a live plan of the result, and one button to use it.
 * The choice is remembered in this browser, so the lab opens on the same building next time.
 */

const KEY = "campusevac:floor";

/** The floor in use: the demo campus, or a designed one. */
export function chooseFloor(spec: BuildingSpec | null) {
  setPlan(spec ? planFor(spec) : DEMO_PLAN);
  // the demo is a choice of building, not a reason to forget a floor someone designed
  if (!spec) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(spec));
  } catch {
    /* remembered for this visit only */
  }
  window.dispatchEvent(new Event(KEY));
}

/** The saved floor, for rendering: nothing on the server, the stored one in the browser, updated when it changes. */
export function useSavedFloor(): BuildingSpec | null {
  const raw = useSyncExternalStore(
    (changed) => {
      window.addEventListener(KEY, changed);
      window.addEventListener("storage", changed);
      return () => {
        window.removeEventListener(KEY, changed);
        window.removeEventListener("storage", changed);
      };
    },
    () => {
      try {
        return localStorage.getItem(KEY);
      } catch {
        return null;
      }
    },
    () => null,
  );
  return useMemo(() => {
    try {
      const spec = JSON.parse(raw ?? "null") as BuildingSpec | null;
      return spec ? { ...DEFAULT_SPEC, ...spec } : null;
    } catch {
      return null;
    }
  }, [raw]);
}

/** The floor chosen last time, if any. */
export function savedFloor(): BuildingSpec | null {
  try {
    const spec = JSON.parse(localStorage.getItem(KEY) ?? "null") as BuildingSpec | null;
    return spec ? { ...DEFAULT_SPEC, ...spec } : null;
  } catch {
    return null;
  }
}

const KIND_COLOR: Record<string, string> = {
  corridor: "#7b7770",
  classroom: "#3b5b8a",
  lab: "#4f7a5a",
  library: "#7a5a3f",
  cafeteria: "#8a6a3f",
  hall: "#6a4f7a",
  office: "#5a5a6a",
  entrance: "#7a6f4f",
};

/** The floor from above, north up: rooms with their headcount, the exits in green. */
export function FloorPreview({ plan }: { plan: Plan }) {
  const b = plan.bounds;
  return (
    <svg viewBox={`${b.minX - 3} ${b.minZ - 3} ${b.maxX - b.minX + 6} ${b.maxZ - b.minZ + 7}`} className="h-auto w-full" role="img" aria-label="Floor plan">
      {plan.rooms.map((room) => {
        const r = room.bounds;
        const w = r.maxX - r.minX;
        const h = r.maxZ - r.minZ;
        return (
          <g key={room.id}>
            <rect x={r.minX} y={r.minZ} width={w} height={h} fill={KIND_COLOR[room.kind ?? "classroom"]} stroke="#16111e" strokeWidth={0.25} />
            {room.kind !== "corridor" && (
              <text x={r.minX + w / 2} y={r.minZ + h / 2} textAnchor="middle" fontSize={Math.min(1.25, w / 8)} fontWeight={800} fill="#fffaf3">
                <tspan x={r.minX + w / 2}>{room.name}</tspan>
                {(room.people ?? 0) > 0 && (
                  <tspan x={r.minX + w / 2} dy={1.5} fontSize={Math.min(1.1, w / 7)} fill="#fffaf3cc">
                    {room.people} people
                  </tspan>
                )}
              </text>
            )}
          </g>
        );
      })}
      {plan.links
        .filter((link) => link.exit)
        .map((link) => (
          <g key={link.id}>
            <circle cx={link.door[0]} cy={link.door[1]} r={1} fill="#16a34a" stroke="#fff" strokeWidth={0.2} />
            {/* side exits are labelled above, the main exit below, always inside the picture */}
            <text
              x={link.door[0] + (link.exit === "west" ? -1.5 : link.exit === "east" ? 1.5 : 0)}
              y={link.door[1] + (link.exit === "main" ? 2.4 : -1.6)}
              textAnchor={link.exit === "west" ? "start" : link.exit === "east" ? "end" : "middle"}
              fontSize={0.9}
              fontWeight={900}
              fill="#39ff88"
            >
              {link.exit === "main" ? "MAIN EXIT" : `EXIT${link.steps ? " (steps)" : ""}`}
            </text>
          </g>
        ))}
    </svg>
  );
}

/** One editable row: what the room is called, what kind it is, how many people are in it. */
function RoomRow({ room, onChange, onRemove }: { room: RoomEntry; onChange: (room: RoomEntry) => void; onRemove: () => void }) {
  return (
    <li className="grid grid-cols-[1fr_6.5rem_3.6rem_1.6rem] items-center gap-1">
      <input
        value={room.name}
        onChange={(e) => onChange({ ...room, name: e.target.value })}
        aria-label="Room name"
        className="min-w-0 border border-paper/20 bg-night px-1.5 py-1 text-[12px] text-paper"
      />
      <select
        value={room.kind}
        onChange={(e) => onChange({ ...room, kind: e.target.value as RoomKind })}
        aria-label="Kind of room"
        className="border border-paper/20 bg-night px-1 py-1 text-[11px] text-paper"
      >
        {(Object.keys(ROOM_KINDS) as RoomKind[]).map((kind) => (
          <option key={kind} value={kind}>
            {ROOM_KINDS[kind].label}
          </option>
        ))}
      </select>
      <input
        type="number"
        min={0}
        max={LIMITS.perRoom}
        value={room.people}
        onChange={(e) => onChange({ ...room, people: Math.max(0, Math.min(LIMITS.perRoom, Number(e.target.value) || 0)) })}
        aria-label="People in the room"
        className="border border-paper/20 bg-night px-1 py-1 text-right font-mono text-[12px] text-paper"
      />
      <button onClick={onRemove} aria-label={`Remove ${room.name}`} className="text-[14px] font-black text-paper/40 hover:text-danger">
        ×
      </button>
    </li>
  );
}

export default function FloorDesigner({ onClose, onUse }: { onClose: () => void; onUse: (spec: BuildingSpec) => void }) {
  const [spec, setSpec] = useState<BuildingSpec>(() => {
    const saved = savedFloor() ?? DEFAULT_SPEC;
    return { ...saved, rooms: roomsOf(saved) };
  });
  const rooms = spec.rooms ?? [];
  const plan = useMemo(() => planFor(spec), [spec]);
  const set = (patch: Partial<BuildingSpec>) => setSpec((s) => ({ ...s, ...patch }));
  const setRooms = (next: RoomEntry[]) => set({ rooms: next.slice(0, LIMITS.rooms) });
  // the quick settings rebuild the list from scratch
  const quick = (patch: Partial<BuildingSpec>) => setSpec((s) => {
    const next = { ...s, ...patch };
    return { ...next, rooms: presetRooms(next) };
  });
  const label = "text-[10px] font-black uppercase tracking-[0.14em] text-paper/60";
  const check = (key: "endExits" | "steppedExit", text: string, disabled = false) => (
    <label className={`flex items-center gap-2 text-[12px] ${disabled ? "opacity-40" : ""}`}>
      <input type="checkbox" checked={!!spec[key]} disabled={disabled} onChange={(e) => set({ [key]: e.target.checked })} className="accent-[var(--sun)]" />
      {text}
    </label>
  );
  const nextNumber = rooms.filter((room) => room.kind === "classroom").length + 1;

  return (
    <div className="pointer-events-auto absolute inset-0 z-40 grid place-items-center bg-night/75 p-2 sm:p-3">
      <section className="brutal-panel-dark max-h-full w-full max-w-5xl overflow-y-auto p-3 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="brutal-tag bg-sun text-ink">Your building</span>
            <h2 className="mt-2 text-xl font-black uppercase leading-tight tracking-[-0.02em]">Set up your floor</h2>
            <p className="mt-1 text-[12px] text-paper/60">List the rooms and how many people are in each. They are laid out along a corridor, with the entrance on the south side.</p>
          </div>
          <button onClick={onClose} className="text-[11px] font-bold uppercase text-paper/50 hover:text-paper">Close</button>
        </div>

        <div className="mt-4 grid gap-5 md:grid-cols-[22rem_1fr]">
          <div className="space-y-4">
            <details className="border border-paper/15 px-2 py-1.5">
              <summary className="cursor-pointer text-[11px] font-black uppercase tracking-[0.12em] text-paper/70">Quick start: a typical school</summary>
              <div className="mt-2 space-y-2">
                <div>
                  <div className={`flex justify-between ${label}`}>
                    Classrooms <span className="font-mono text-paper">{spec.classrooms}</span>
                  </div>
                  <input type="range" min={LIMITS.classrooms[0]} max={LIMITS.classrooms[1]} value={spec.classrooms} onChange={(e) => quick({ classrooms: Number(e.target.value) })} className="w-full accent-[var(--sun)]" />
                </div>
                <div>
                  <div className={`flex justify-between ${label}`}>
                    Students in each <span className="font-mono text-paper">{spec.studentsPerClassroom}</span>
                  </div>
                  <input type="range" min={LIMITS.students[0]} max={LIMITS.students[1]} value={spec.studentsPerClassroom} onChange={(e) => quick({ studentsPerClassroom: Number(e.target.value) })} className="w-full accent-[var(--sun)]" />
                </div>
                <p className="text-[10px] text-paper/45">Changing these replaces the room list below.</p>
              </div>
            </details>

            <div>
              <div className={`flex justify-between ${label}`}>
                Rooms <span className="font-mono normal-case tracking-normal text-paper/50">name · kind · people</span>
              </div>
              <ul className="mt-1.5 max-h-[16rem] space-y-1 overflow-y-auto pr-1">
                {rooms.map((room, i) => (
                  <RoomRow
                    key={i}
                    room={room}
                    onChange={(next) => setRooms(rooms.map((r, j) => (j === i ? next : r)))}
                    onRemove={() => setRooms(rooms.filter((_, j) => j !== i))}
                  />
                ))}
              </ul>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {(Object.keys(ROOM_KINDS) as RoomKind[]).map((kind) => (
                  <button
                    key={kind}
                    disabled={rooms.length >= LIMITS.rooms}
                    onClick={() =>
                      setRooms([...rooms, { kind, name: kind === "classroom" ? `Classroom ${nextNumber}` : ROOM_KINDS[kind].label, people: ROOM_KINDS[kind].people }])
                    }
                    className="border border-dashed border-paper/30 px-1.5 py-0.5 text-[10px] font-bold text-paper/70 hover:border-sun hover:text-paper disabled:opacity-40"
                  >
                    + {ROOM_KINDS[kind].label}
                  </button>
                ))}
              </div>
              {rooms.length >= LIMITS.rooms && <p className="mt-1 text-[10px] text-sun">That is the most one floor can hold ({LIMITS.rooms} rooms).</p>}
            </div>

            <div className="space-y-1.5">
              <div className={label}>Ways out</div>
              <div className="text-[12px] text-paper/70">Main exit through the entrance, always.</div>
              {check("endExits", "Fire exits at both ends of the corridor")}
              {check("steppedExit", "The west fire exit has steps outside", !spec.endExits)}
              {!spec.endExits && <p className="text-[11px] text-danger">One way out for everyone. This is how 94 children died at Kumbakonam.</p>}
            </div>
          </div>

          <div>
            <div className="border border-paper/15 bg-night/60 p-2">
              <FloorPreview plan={plan} />
            </div>
            <p className="mt-2 text-[12px] leading-snug text-paper/75">
              <b>{peopleIn(plan)} people</b> inside when the alarm goes. Twelve of them are AI people spread across the rooms, including a wheelchair user, a
              deaf student, someone who panics and an elderly visitor; everyone else follows them, the signs and the announcements.
            </p>
            <p className="mt-1 text-[11px] text-paper/50">Fires to try: {plan.scenarios.map((s) => s.label.replace(/^Fire in the /, "")).join(", ")}.</p>
            <button onClick={() => onUse(spec)} disabled={!rooms.length} className="brutal-button mt-3 w-full px-4 py-3 disabled:opacity-50">
              Use this floor
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
