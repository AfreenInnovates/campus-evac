import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { after } from "next/server";
import { z } from "zod";
import { fixById, type FixId } from "../simulation/crowd/fixes";
import { placeName } from "../simulation/crowd/world";
import { canStart, drillRooms, findDrill, FIX_IDS, scenarioFor, startDrill, type DrillRequest } from "./drills";
import { resolveRoom } from "./evac";
import { answer, READ_ONLY, refuse } from "./reply";
import { drillResult } from "./tasks";

/**
 * The what-if tools: run a Crowd Lab drill (Nemotron people and warden) in this building, read
 * how it went, and rerun it with changes to see what they fix. A drill takes minutes, so it is
 * started and asked about later: by id for any client, or as an MCP Task for one that speaks
 * them.
 */

/** Keep running after the reply is sent: Next.js's `after` on a server, a loose promise elsewhere (tests). */
function background(work: Promise<unknown>) {
  try {
    after(work);
  } catch {
    void work;
  }
}

/** Starting a drill spends model credits: when MCP_DRILL_KEY is set, only callers with it may. */
function authorised(headers: Record<string, string | string[] | undefined> | undefined) {
  const key = process.env.MCP_DRILL_KEY?.trim();
  if (!key) return true;
  const sent = headers?.authorization;
  return (Array.isArray(sent) ? sent[0] : sent) === `Bearer ${key}`;
}

const DRILL_RUNS = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;

const drillArgs = {
  fire_room: z.string().describe("Where the fire starts, by room name (e.g. \"Cafeteria\", \"the library\")."),
  people: z.number().int().min(4).max(12).optional().describe("How many AI people are in the building. Defaults to 8."),
  warden: z.enum(["ai", "none"]).optional().describe("\"ai\": an AI fire warden directs people over the PA (default). \"none\": nobody does."),
  fixes: z.array(z.enum(FIX_IDS)).optional().describe("Changes to make to the building first, e.g. [\"ramp\", \"strobes\"]. See list_safety_fixes."),
};

type DrillArgs = { fire_room: string; people?: number; warden?: "ai" | "none"; fixes?: FixId[] };

/** Turn a caller's request into a drill, or say plainly why not. */
function requestFrom(args: DrillArgs): DrillRequest | CallToolResult {
  const room = resolveRoom(args.fire_room);
  const scenario = room ? scenarioFor(room) : null;
  if (!scenario) return refuse(`Drills can start a fire in: ${drillRooms().join(", ")}. "${args.fire_room}" is not one of them.`);
  return {
    scenarioId: scenario.id,
    people: args.people ?? 8,
    warden: args.warden ?? "ai",
    fixes: [...new Set(args.fixes ?? [])],
    seed: 1 + Math.floor(Math.random() * 9999),
  };
}

const fixesSaid = (fixes: FixId[]) => (fixes.length ? ` with ${fixes.map((id) => fixById(id).title.toLowerCase()).join(" and ")}` : "");

export function registerDrillTools(server: McpServer) {
  const begin = async (request: DrillRequest, headers: Record<string, string | string[] | undefined> | undefined, id?: string) => {
    if (!authorised(headers)) return refuse("Starting drills needs this server's drill key.");
    const gate = canStart();
    if (!gate.ok) return refuse(gate.reason);
    return startDrill(request, background, id);
  };

  server.registerTool(
    "start_drill",
    {
      title: "Start a what-if fire drill",
      description:
        "Run a simulated fire drill in the building: AI people (including wheelchair users, deaf, elderly and panicking people) try to get out while an AI warden directs them. Returns a drill id at once; the drill takes up to four minutes, then get_drill_result says how it went.",
      inputSchema: drillArgs,
      annotations: DRILL_RUNS,
    },
    async (args, extra) => {
      const request = requestFrom(args);
      if ("content" in request) return request;
      const started = await begin(request, extra.requestInfo?.headers);
      if ("content" in started) return started;
      const where = placeName(scenarioFor(resolveRoom(args.fire_room)!)!.origin);
      return answer(
        `Starting a fire drill in the ${where} with ${request.people} people${fixesSaid(request.fixes)}. It takes up to four minutes; ask me for the result after that.`,
        { drill_id: started.id, status: started.status },
      );
    },
  );

  server.registerTool(
    "get_drill_result",
    {
      title: "Get a drill's result",
      description: "How a drill went: how many got out, sheltered or collapsed, how long it took, and who the evacuation plan let down and why. Says so if it is still running.",
      inputSchema: { drill_id: z.string().optional().describe("The id start_drill or compare_fixes returned. Leave out for the most recent drill.") },
      annotations: READ_ONLY,
    },
    async ({ drill_id }) => {
      const record = await findDrill(drill_id);
      if (record) return drillResult(record);
      return refuse(drill_id && /^drill-/.test(drill_id) ? `There is no drill ${drill_id}.` : "No drill has been run yet. Start one with start_drill.");
    },
  );

  server.registerTool(
    "compare_fixes",
    {
      title: "Rerun a drill with fixes",
      description:
        "Rerun a finished drill with changes to the building (a ramp, strobes, text alerts...): the same fire and the same people in the same places, so the difference is the fixes. Returns a new drill id; its result compares the two.",
      inputSchema: {
        drill_id: z.string().optional().describe("The finished drill to rerun. Leave out for the most recent drill."),
        fixes: z.array(z.enum(FIX_IDS)).min(1).describe("The changes to try. See list_safety_fixes."),
      },
      annotations: DRILL_RUNS,
    },
    async ({ drill_id, fixes }, extra) => {
      const baseline = await findDrill(drill_id);
      if (!baseline) return refuse(drill_id && /^drill-/.test(drill_id) ? `There is no drill ${drill_id}.` : "There is no drill to rerun yet. Start one with start_drill first.");
      if (baseline.status !== "completed") return refuse("That drill has not finished yet; compare once it has.");
      const request: DrillRequest = { ...baseline.request, fixes: [...new Set([...baseline.request.fixes, ...fixes])], compareWith: baseline.id };
      const started = await begin(request, extra.requestInfo?.headers);
      if ("content" in started) return started;
      return answer(`Rerunning the same drill${fixesSaid(fixes)}. Give it up to four minutes, then ask for the result to see the difference.`, {
        drill_id: started.id,
        baseline: baseline.id,
        status: started.status,
      });
    },
  );

  // the same drill as an MCP Task, for clients that poll tasks instead of asking by id
  server.experimental.tasks.registerToolTask(
    "run_drill",
    {
      title: "Run a what-if fire drill (task)",
      description: "start_drill as an MCP Task: the call returns a task at once, and the task's result is the drill's result.",
      inputSchema: drillArgs,
      annotations: DRILL_RUNS,
      execution: { taskSupport: "required" },
    },
    {
      createTask: async (args, extra) => {
        const request = requestFrom(args);
        if ("content" in request) throw new Error(String((request.content[0] as { text: string }).text));
        const task = await extra.taskStore.createTask({ ttl: 24 * 3_600_000 });
        const started = await begin(request, extra.requestInfo?.headers, task.taskId);
        if ("content" in started) throw new Error(String((started.content[0] as { text: string }).text));
        return { task };
      },
      getTask: async (_args, extra) => {
        const task = await extra.taskStore.getTask(extra.taskId);
        if (!task) throw new Error(`No drill ${extra.taskId}`);
        return task;
      },
      getTaskResult: async (_args, extra) => (await extra.taskStore.getTaskResult(extra.taskId)) as CallToolResult,
    },
  );
}
