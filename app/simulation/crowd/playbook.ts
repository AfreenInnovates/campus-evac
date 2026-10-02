"use client";

import { create } from "zustand";

/**
 * The warden's memory between drills.
 *
 * After each drill Nemotron Ultra reviews the whole log and rewrites a short playbook of
 * standing orders; the next drill's warden is given them. The history records how every
 * drill went against the playbook version it used, which is what the learning curve plots.
 *
 * The shared copy lives on the server (DynamoDB, see /api/warden) so every visitor meets the
 * same trained warden. When the server cannot be reached the lab keeps working from this
 * browser's own copy, and says so.
 */

export interface Rule {
  text: string;
  /** the drill whose review added or last rewrote this rule */
  from: number;
}

export interface Playbook {
  version: number;
  rules: Rule[];
  /** what the last review changed, in its own words */
  lastChange: string;
}

export type PointTag = "train" | "baseline" | "trained";

export interface TrainingPoint {
  drill: number;
  at: number;
  tag: PointTag;
  scenarioId: string;
  scenario: string;
  seed: number;
  playbookVersion: number;
  rules: number;
  /** objective outcomes */
  survival: number;
  exposure: number;
  meanEscape: number | null;
  /** Nemotron Ultra's 0-10 judgement of the coordination */
  score: number | null;
  cost: number;
  /** what the review changed in the playbook after this drill (training only) */
  change?: { added: string[]; removed: string[]; note: string };
}

type Storage = "loading" | "shared" | "local";

const PLAYBOOK_KEY = "campusevac:warden-playbook";
const HISTORY_KEY = "campusevac:warden-history";
const ADMIN_KEY = "campusevac:warden-key";
export const MAX_RULES = 6;

const EMPTY: Playbook = { version: 0, rules: [], lastChange: "" };

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* kept for this page only */
  }
}

export const usePlaybook = create<{
  playbook: Playbook;
  history: TrainingPoint[];
  storage: Storage;
  /** the server only accepts training from the lab owner */
  locked: boolean;
  canTrain: boolean;
}>(() => ({
  playbook: EMPTY,
  history: [],
  storage: "loading",
  locked: false,
  canTrain: true,
}));

export const adminKey = () => read<string>(ADMIN_KEY, "");

/** Load the shared playbook, or this browser's copy if the server is unavailable. */
export async function hydratePlaybook() {
  try {
    const response = await fetch("/api/warden", { cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    const body = (await response.json()) as { playbook: Playbook | null; history: TrainingPoint[]; locked: boolean };
    const history = [...(body.history ?? [])].sort((a, b) => a.drill - b.drill || a.at - b.at);
    usePlaybook.setState({
      playbook: body.playbook ?? EMPTY,
      history,
      storage: "shared",
      locked: body.locked,
      canTrain: !body.locked || !!adminKey(),
    });
  } catch {
    usePlaybook.setState({
      playbook: read(PLAYBOOK_KEY, EMPTY),
      history: read(HISTORY_KEY, [] as TrainingPoint[]),
      storage: "local",
      locked: false,
      canTrain: true,
    });
  }
}

/** The lab owner's key, kept in this browser only, unlocks training the shared warden. */
export function unlockTraining(key: string) {
  write(ADMIN_KEY, key.trim());
  usePlaybook.setState({ canTrain: !!key.trim() });
}

async function save(body: unknown) {
  const { storage } = usePlaybook.getState();
  if (storage !== "shared") return;
  try {
    const response = await fetch("/api/warden", {
      method: "POST",
      headers: { "content-type": "application/json", "x-warden-key": adminKey() },
      body: JSON.stringify(body),
    });
    if (response.status === 403) usePlaybook.setState({ canTrain: false });
  } catch {
    /* the local copy still has it */
  }
}

export function nextDrillNumber() {
  const history = usePlaybook.getState().history;
  return history.length ? Math.max(...history.map((p) => p.drill)) + 1 : 1;
}

/** Replace the rules with a review's revised set, and report what actually changed. */
export function adoptRules(texts: string[], drill: number, note: string) {
  const current = usePlaybook.getState().playbook;
  const seen = new Set<string>();
  const rules: Rule[] = [];
  for (const raw of texts) {
    const text = String(raw).replace(/\s+/g, " ").trim().slice(0, 200);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    // an unchanged rule keeps the drill it came from
    const kept = current.rules.find((rule) => rule.text.toLowerCase() === key);
    rules.push(kept ?? { text, from: drill });
    if (rules.length >= MAX_RULES) break;
  }
  const before = new Set(current.rules.map((r) => r.text.toLowerCase()));
  const after = new Set(rules.map((r) => r.text.toLowerCase()));
  const change = {
    added: rules.filter((r) => !before.has(r.text.toLowerCase())).map((r) => r.text),
    removed: current.rules.filter((r) => !after.has(r.text.toLowerCase())).map((r) => r.text),
    note: note.slice(0, 300),
  };
  const playbook: Playbook = { version: current.version + 1, rules, lastChange: change.note };
  write(PLAYBOOK_KEY, playbook);
  usePlaybook.setState({ playbook });
  void save({ type: "playbook", playbook });
  return change;
}

export function recordPoint(point: TrainingPoint) {
  const history = [...usePlaybook.getState().history, point].slice(-200);
  write(HISTORY_KEY, history);
  usePlaybook.setState({ history });
  void save({ type: "point", point });
}

export function resetTraining() {
  write(PLAYBOOK_KEY, EMPTY);
  write(HISTORY_KEY, []);
  usePlaybook.setState({ playbook: EMPTY, history: [] });
  void save({ type: "reset" });
}

/** The standing orders as the warden's prompt carries them. */
export function standingOrders(playbook: Playbook) {
  if (!playbook.rules.length) return "";
  return [
    `Standing orders you learned from your previous drills (playbook v${playbook.version}). Follow them:`,
    ...playbook.rules.map((rule, i) => `${i + 1}. ${rule.text}`),
  ].join("\n");
}
