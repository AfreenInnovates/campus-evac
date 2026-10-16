import type { CreateTaskOptions, TaskStore } from "@modelcontextprotocol/sdk/experimental/tasks/interfaces.js";
import type { CallToolResult, Result, Task } from "@modelcontextprotocol/sdk/types.js";
import { getDrill, newDrillId, speakDrill, type DrillRecord } from "./drills";

/**
 * MCP Tasks (protocol 2025-11-25) for drills: a task is a drill, and its id is the drill's id.
 *
 * Every request gets a fresh server, so the SDK's in-memory store would forget a task between
 * the call that starts it and the poll that asks about it. This store reads the drill records
 * instead, which live in memory and in DynamoDB, so any request on any instance can answer.
 */

/** Drills take minutes; there is no point asking more often than this. */
const POLL_MS = 10_000;
/** How long a finished drill stays fetchable as a task. */
const TTL_MS = 24 * 3_600_000;

/** Task ids handed out whose drill has not been saved yet: the moment between createTask and startDrill. */
const reserved = ((globalThis as { __campusevacTasks?: Map<string, number> }).__campusevacTasks ??= new Map());

const statusOf = (record: DrillRecord): Task["status"] => (record.status === "running" ? "working" : record.status);

export function drillResult(record: DrillRecord): CallToolResult {
  const speech = speakDrill(record);
  const data = { drill_id: record.id, status: record.status, outcome: record.outcome ?? null, comparison: record.comparison ?? null, error: record.error ?? null };
  return {
    content: [
      { type: "text", text: speech },
      { type: "text", text: JSON.stringify(data) },
    ],
    structuredContent: { speech, ...data },
    isError: record.status === "failed" ? true : undefined,
  };
}

export class DrillTaskStore implements TaskStore {
  async createTask(options: CreateTaskOptions): Promise<Task> {
    const taskId = newDrillId();
    const now = Date.now();
    reserved.set(taskId, now);
    const at = new Date(now).toISOString();
    return { taskId, status: "working", ttl: options.ttl ?? TTL_MS, createdAt: at, lastUpdatedAt: at, pollInterval: POLL_MS };
  }

  async getTask(taskId: string): Promise<Task | null> {
    const record = await getDrill(taskId);
    if (!record) {
      const at = reserved.get(taskId);
      if (at === undefined) return null;
      const iso = new Date(at).toISOString();
      return { taskId, status: "working", ttl: TTL_MS, createdAt: iso, lastUpdatedAt: iso, pollInterval: POLL_MS };
    }
    reserved.delete(taskId);
    return {
      taskId,
      status: statusOf(record),
      ttl: TTL_MS,
      createdAt: new Date(record.createdAt).toISOString(),
      lastUpdatedAt: new Date(record.finishedAt ?? record.createdAt).toISOString(),
      pollInterval: POLL_MS,
      statusMessage: record.status === "running" ? speakDrill(record) : undefined,
    };
  }

  /** The result is the drill record itself, saved by the drill as it finishes. */
  async storeTaskResult(): Promise<void> {}

  async getTaskResult(taskId: string): Promise<Result> {
    const record = await getDrill(taskId);
    if (!record) throw new Error(`No drill ${taskId}`);
    return drillResult(record);
  }

  /** A drill cannot be stopped part way: the engine runs it to the end either way. */
  async updateTaskStatus(): Promise<void> {}

  async listTasks(): Promise<{ tasks: Task[] }> {
    return { tasks: [] };
  }
}
