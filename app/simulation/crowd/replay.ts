"use client";

import type { LabConfig, LogEntry, Persona, RunResult } from "./engine";

/**
 * Recorded drills.
 *
 * A replay is the drill's own state sampled a few times a second - where everyone was, how
 * they were doing, what they last thought, what order they were following - plus the event
 * log. Playing it back drives the same scene, narrator and panels as a live drill, with no
 * model calls, so it is instant and free. That is what lets anyone watch drill 1 and then
 * drill 6 and see the warden improve.
 */

export interface ReplayPerson {
  id: number;
  name: string;
  color: string;
  persona: Persona;
}

/** Per person per frame: x, z, heading, status, sheltering (1, or 2 for frozen in panic), pace, health, lastDecisionAt, thought, order status, order target. */
export const FIELDS = 11;
export const STATUS = ["inside", "safe", "down"] as const;
export const PACE = ["walk", "run", "crawl"] as const;
export const ORDER = ["", "heard", "following", "ignored", "done"] as const;

export interface Replay {
  id: string;
  at: number;
  /** the training drill it recorded, if it was one */
  drill: number | null;
  config: LabConfig;
  people: ReplayPerson[];
  /** each frame: [t, ...FIELDS values per person] */
  frames: number[][];
  /** strings referenced by index from the frames */
  thoughts: string[];
  targets: string[];
  log: LogEntry[];
  result: RunResult;
}

export const FRAME_EVERY = 0.4;

/* ------------------------------------------------------------------ storage */

const DB = "campusevac-replays";
const STORE = "replays";
const KEEP = 30;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = run(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveReplay(replay: Replay) {
  try {
    await tx("readwrite", (store) => store.put(replay));
    const all = await listReplays();
    for (const old of all.slice(KEEP)) await tx("readwrite", (store) => store.delete(old.id));
  } catch {
    /* replays are a convenience; a full or blocked store just means no replay */
  }
}

/** Newest first. */
export async function listReplays(): Promise<Replay[]> {
  try {
    const all = await tx<Replay[]>("readonly", (store) => store.getAll());
    return all.sort((a, b) => b.at - a.at);
  } catch {
    return [];
  }
}

export async function replayForDrill(drill: number) {
  return (await listReplays()).find((r) => r.drill === drill) ?? null;
}

export async function replayById(id: string) {
  return (await listReplays()).find((r) => r.id === id) ?? null;
}

export async function clearReplays() {
  try {
    await tx("readwrite", (store) => store.clear());
  } catch {
    /* nothing to clear */
  }
}

/* ------------------------------------------------------------------ sharing */

/** gzip + base64, so a training replay fits comfortably in one DynamoDB item. */
async function pack(replay: Replay) {
  const stream = new Blob([JSON.stringify(replay)]).stream().pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function unpack(data: string): Promise<Replay> {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text()) as Replay;
}

/** Publish a training drill's replay with the shared warden. Best effort. */
export async function shareReplay(replay: Replay, key: string) {
  if (replay.drill === null) return;
  try {
    await fetch("/api/warden", {
      method: "POST",
      headers: { "content-type": "application/json", "x-warden-key": key },
      body: JSON.stringify({ type: "replay", drill: replay.drill, data: await pack(replay) }),
    });
  } catch {
    /* the local copy is still there */
  }
}

/** A training drill's replay: this browser's copy, or the shared one. */
export async function findReplay(drill: number): Promise<Replay | null> {
  const local = await replayForDrill(drill);
  if (local) return local;
  try {
    const response = await fetch(`/api/warden?replay=${drill}`, { cache: "no-store" });
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: string };
    return body.data ? await unpack(body.data) : null;
  } catch {
    return null;
  }
}
