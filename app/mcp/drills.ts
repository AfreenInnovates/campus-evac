import { GetItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { runTask } from "../api/crowd/nebius";
import { db, persistent, readShared, TABLE } from "../api/warden/store";
import { findings, lab, MAX_RUN_SECONDS, setRunning, setupRun, step, summarise, type Finding, type RunResult, type WardenMode } from "../simulation/crowd/engine";
import { fixById, FIXES, type FixId } from "../simulation/crowd/fixes";
import { usePlaybook } from "../simulation/crowd/playbook";
import { gridFromWalls } from "../simulation/crowd/walls";
import { DEMO_PLAN, placeName, SCENARIOS, setPlan, type RoomId } from "../simulation/crowd/world";

/**
 * Crowd Lab drills run on the server, for voice assistants: the same engine, the same Nemotron
 * evacuees and warden as the browser, with the building's sensors in place of the camera and a
 * walking map read off the wall plan.
 *
 * A drill takes as long as it would on screen (up to four minutes), so it is started, runs in
 * the background, and is asked about later by id. The engine holds one drill at a time, so
 * this server runs one at a time and turns others away while it is busy.
 *
 * Records are kept in memory and, when AWS is reachable, in the events table, so a result can
 * be read from any server instance.
 */

export interface DrillRequest {
  scenarioId: string;
  people: number;
  warden: Exclude<WardenMode, "human">;
  fixes: FixId[];
  seed: number;
  /** the drill this one reruns with fixes, for a before-and-after */
  compareWith?: string;
}

export interface DrillOutcome {
  scenario: string;
  fire_room: string;
  people: number;
  got_out: number;
  sheltering: number;
  collapsed: number;
  still_inside: number;
  seconds: number;
  mean_escape_seconds: number | null;
  exits_used: Record<string, number>;
  announcements: number;
  model_calls: number;
  cost_usd: number;
  /** who the plan failed, in plain words */
  failed: { name: string; who: string; outcome: string; trouble: string[] }[];
}

export interface Comparison {
  baseline: string;
  fixes: string[];
  got_out: { before: number; after: number };
  sheltering: { before: number; after: number };
  collapsed: { before: number; after: number };
  mean_escape_seconds: { before: number | null; after: number | null };
  helped: string[];
}

export interface DrillRecord {
  id: string;
  status: "running" | "completed" | "failed";
  request: DrillRequest;
  createdAt: number;
  finishedAt?: number;
  outcome?: DrillOutcome;
  comparison?: Comparison;
  error?: string;
}

/* ------------------------------------------------------------------ the store */

/** Kept on globalThis so a module reload (Next.js in development) does not lose drills in progress. */
interface Shared {
  memory: Map<string, DrillRecord>;
  /** when each drill this hour started */
  started: number[];
  busy: string | null;
  latest: string | null;
}
const shared = ((globalThis as { __campusevacDrills?: Shared }).__campusevacDrills ??= { memory: new Map(), started: [], busy: null, latest: null } as Shared);
const memory = shared.memory;
const DRILL_PK = { S: "drill" };

async function save(record: DrillRecord) {
  memory.set(record.id, record);
  shared.latest = record.id;
  if (!persistent()) return;
  try {
    await db().send(new PutItemCommand({ TableName: TABLE, Item: { pk: DRILL_PK, sk: { S: record.id }, data: { S: JSON.stringify(record) } } }));
    // which drill is newest, for "how did the drill go?" with no id
    await db().send(new PutItemCommand({ TableName: TABLE, Item: { pk: DRILL_PK, sk: { S: "latest" }, data: { S: record.id } } }));
  } catch {
    /* no AWS here: this instance's memory is the store */
  }
}

export async function getDrill(id: string): Promise<DrillRecord | null> {
  const local = memory.get(id);
  if (local || !persistent()) return local ?? null;
  try {
    const item = await db().send(new GetItemCommand({ TableName: TABLE, Key: { pk: DRILL_PK, sk: { S: id } } }));
    return item.Item?.data?.S ? (JSON.parse(item.Item.data.S) as DrillRecord) : null;
  } catch {
    return null;
  }
}

/** The most recent drill: what someone means by "the drill" when they give no id. */
export async function latestDrill(): Promise<DrillRecord | null> {
  if (shared.latest) return getDrill(shared.latest);
  if (!persistent()) return null;
  try {
    const item = await db().send(new GetItemCommand({ TableName: TABLE, Key: { pk: DRILL_PK, sk: { S: "latest" } } }));
    return item.Item?.data?.S ? getDrill(item.Item.data.S) : null;
  } catch {
    return null;
  }
}

/** A drill by id, where a missing id, or a word like "latest" or "last", means the most recent one. */
export const findDrill = (id: string | undefined) => (id && /^drill-/.test(id) ? getDrill(id) : latestDrill());

/* ------------------------------------------------------------------ limits */

/** Each drill spends up to the lab's run budget in Nemotron calls; cap how many a public endpoint will start. */
const PER_HOUR = Math.max(1, Number(process.env.MCP_DRILLS_PER_HOUR) || 6);
const started = shared.started;

export function canStart(): { ok: true } | { ok: false; reason: string } {
  if (shared.busy) return { ok: false, reason: "A drill is already running. Ask for its result in a minute or two, then start the next one." };
  const hourAgo = Date.now() - 3_600_000;
  while (started.length && started[0] < hourAgo) started.shift();
  if (started.length >= PER_HOUR) return { ok: false, reason: `This server runs at most ${PER_HOUR} drills an hour, and that is used up. Try again later.` };
  return { ok: true };
}

/* ------------------------------------------------------------------ choosing the drill */

/** The drill scenario that starts the fire in a room, if the campus has one. */
export function scenarioFor(room: RoomId) {
  return SCENARIOS.find((s) => s.origin === room) ?? null;
}

export const drillRooms = () => SCENARIOS.map((s) => placeName(s.origin));

export const FIX_IDS = FIXES.map((fix) => fix.id) as [FixId, ...FixId[]];

/* ------------------------------------------------------------------ running */

export const newDrillId = () => `drill-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Start a drill; it runs in the background. Call `canStart` first. */
export async function startDrill(request: DrillRequest, background: (work: Promise<unknown>) => void, id = newDrillId()): Promise<DrillRecord> {
  const record: DrillRecord = { id, status: "running", request, createdAt: Date.now() };
  shared.busy = record.id;
  started.push(Date.now());
  await save(record);
  background(
    run(record).finally(() => {
      if (shared.busy === record.id) shared.busy = null;
    }),
  );
  return record;
}

async function run(record: DrillRecord) {
  try {
    if (!process.env.NEBIUS_API_KEY) throw new Error("NEBIUS_API_KEY is not set on this server");
    record.outcome = await simulate(record.request);
    if (record.request.compareWith) {
      const baseline = await getDrill(record.request.compareWith);
      if (baseline?.outcome) record.comparison = compare(baseline, record.outcome, record.request.fixes);
    }
    record.status = "completed";
  } catch (error) {
    record.status = "failed";
    record.error = (error as Error).message;
  }
  record.finishedAt = Date.now();
  await save(record);
}

async function simulate(request: DrillRequest): Promise<DrillOutcome> {
  // the trained warden, if the shared playbook can be read; otherwise an untrained one
  try {
    const { playbook } = await readShared();
    if (playbook) usePlaybook.setState({ playbook });
  } catch {
    /* untrained */
  }
  setPlan(DEMO_PLAN);
  lab.grid = gridFromWalls(DEMO_PLAN);
  lab.capture = null;
  lab.headless = { model: (task, input) => runTask(task, input, null) };
  setupRun({ scenarioId: request.scenarioId, agents: request.people, warden: request.warden, seed: request.seed, wardenEvery: 12, playbook: true, fixes: request.fixes });
  const runId = lab.runId;
  setRunning(true);

  // real time, as on screen: the people think while the clock runs, so the pace matters
  let last = performance.now();
  const deadline = Date.now() + (MAX_RUN_SECONDS + 30) * 1000;
  while (!lab.finished && Date.now() < deadline) {
    await sleep(100);
    if (lab.runId !== runId) throw new Error("drill interrupted");
    const now = performance.now();
    step(Math.min(0.25, (now - last) / 1000));
    last = now;
  }
  setRunning(false);
  lab.headless = null;
  const summary = summarise();
  if (!summary) throw new Error("drill did not start");
  return outcomeOf(summary, findings());
}

function outcomeOf(summary: RunResult, found: Finding[]): DrillOutcome {
  return {
    scenario: summary.scenario,
    fire_room: placeName(lab.scenario!.origin),
    people: summary.agents,
    got_out: summary.safe,
    sheltering: summary.sheltered,
    collapsed: summary.down,
    still_inside: summary.inside,
    seconds: summary.seconds,
    mean_escape_seconds: summary.meanEscape,
    exits_used: summary.exits,
    announcements: summary.announcements,
    model_calls: summary.calls,
    cost_usd: summary.cost,
    failed: found.map((f) => ({ name: f.name, who: f.label, outcome: f.outcome, trouble: f.trouble })),
  };
}

function compare(baseline: DrillRecord, after: DrillOutcome, fixes: FixId[]): Comparison {
  const before = baseline.outcome!;
  const troubled = new Set(after.failed.map((f) => f.name));
  return {
    baseline: baseline.id,
    fixes: fixes.map((id) => fixById(id).title),
    got_out: { before: before.got_out, after: after.got_out },
    sheltering: { before: before.sheltering, after: after.sheltering },
    collapsed: { before: before.collapsed, after: after.collapsed },
    mean_escape_seconds: { before: before.mean_escape_seconds, after: after.mean_escape_seconds },
    // the same seed puts the same people in the same places, so names line up across the two runs
    helped: before.failed.filter((f) => !troubled.has(f.name)).map((f) => `${f.name} (${f.who})`),
  };
}

/* ------------------------------------------------------------------ saying it */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function speakDrill(record: DrillRecord): string {
  if (record.status === "running") {
    const seconds = Math.round((Date.now() - record.createdAt) / 1000);
    return `The drill is still running, ${seconds} seconds in. Drills take up to four minutes; ask again shortly.`;
  }
  if (record.status === "failed" || !record.outcome) return `The drill could not finish: ${record.error ?? "unknown error"}.`;
  const o = record.outcome;
  const parts = [
    `In the drill "${o.scenario}", ${o.got_out} of ${o.people} people got out`,
    o.sheltering ? `${o.sheltering} sheltered in place` : "",
    o.collapsed ? `${plural(o.collapsed, "person", "people")} collapsed` : "",
    o.still_inside ? `${o.still_inside} were still inside at the end` : "",
  ].filter(Boolean);
  let speech = `${parts.join(", ")}.`;
  if (o.mean_escape_seconds !== null) speech += ` On average it took ${o.mean_escape_seconds} seconds to get out.`;
  const worst = o.failed.slice(0, 2).map((f) => `${f.name} (${f.who}): ${f.trouble[0] ?? f.outcome}`);
  if (worst.length) speech += ` Who the plan let down: ${worst.join("; ")}.`;
  const c = record.comparison;
  if (c) {
    const added = c.fixes.map((fix) => fix.toLowerCase()).join(" and ");
    const changes = [`${c.got_out.before} got out before, ${c.got_out.after} now`];
    if (c.sheltering.before !== c.sheltering.after) changes.push(`${c.sheltering.before} sheltered before, ${c.sheltering.after} now`);
    if (c.collapsed.before !== c.collapsed.after) changes.push(`${c.collapsed.before} collapsed before, ${c.collapsed.after} now`);
    if (c.mean_escape_seconds.before !== null && c.mean_escape_seconds.after !== null)
      changes.push(`the average escape went from ${c.mean_escape_seconds.before} to ${c.mean_escape_seconds.after} seconds`);
    speech += ` With ${added} added: ${changes.join("; ")}.`;
    if (c.helped.length) speech += ` It fixed things for ${c.helped.join(", ")}.`;
  }
  return speech;
}
