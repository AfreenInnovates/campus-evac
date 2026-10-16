import { test } from "node:test";
import assert from "node:assert/strict";
import { adviseRoute, everyRoom, findRoute, planEvacuation, resolveRoom, smokeForecast } from "./evac.ts";
import { POST, GET } from "../api/mcp/route.ts";

// never write test rows into the real DynamoDB table, even on a machine with AWS access
process.env.MCP_STORE = "memory";

test("rooms resolve from the names people use", () => {
  assert.equal(resolveRoom("the gym"), "gym");
  assert.equal(resolveRoom("Library"), "library");
  assert.equal(resolveRoom("chemistry lab"), "sec");
  assert.equal(resolveRoom("complab"), "complab");
  assert.equal(resolveRoom("swimming pool"), null);
});

test("with no fire, the library leaves by its own west fire exit", () => {
  const route = findRoute("library")!;
  assert.equal(route.exit, "West Fire Exit");
  assert.equal(route.doorways, 1);
  assert.equal(route.steps[0].heading, "west");
});

test("a wheelchair user is never routed over the stepped west exit", () => {
  const route = findRoute("library", { stepFree: true })!;
  assert.notEqual(route.exit, "West Fire Exit");
  assert.ok(route.step_free);
});

test("a route avoids the fire room when there is another way", () => {
  // the cafeteria's own east exit is inside the fire; the north wing goes out by the north exit
  const route = findRoute("ncorr", { fire: { room: "cafe", seconds: 5 } })!;
  assert.equal(route.through_fire, false);
  assert.equal(route.exit, "North Fire Exit");
});

test("someone in the fire room is always told to leave", () => {
  assert.equal(adviseRoute("cafe", { fire: { room: "cafe", seconds: 200 } }).action, "evacuate");
});

test("cut off by choking smoke means shelter in place", () => {
  const advice = adviseRoute("complab", { fire: { room: "lecture", seconds: 200 } });
  assert.equal(advice.action, "shelter");
  assert.match(advice.speech, /shut the door/);
});

test("smoke is worst in the fire room and rises with time", () => {
  const early = smokeForecast({ room: "library", seconds: 10 });
  const late = smokeForecast({ room: "library", seconds: 120 });
  assert.equal(late[0].condition, "on fire");
  assert.ok(late.reduce((n, r) => n + r.smoke, 0) > early.reduce((n, r) => n + r.smoke, 0));
});

test("the plan spreads people over more than one exit", () => {
  const plan = planEvacuation(null, everyRoom());
  assert.ok(Object.keys(plan.exit_load).length >= 3);
  assert.equal(plan.assignments.length, everyRoom().size);
  assert.match(plan.broadcast, /leave by the/);
});

/* ------------------------------------------------------------------ over the wire */

const rpc = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
      body: JSON.stringify(body),
    }),
  );

test("initialize negotiates protocol 2025-11-25", async () => {
  const res = await rpc({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.result.protocolVersion, "2025-11-25");
  assert.equal(body.result.serverInfo.name, "campusevac");
  assert.ok(body.result.capabilities.tools);
  assert.ok(body.result.capabilities.tasks.requests.tools.call);
});

test("tools are listed and callable", async () => {
  const headers = { "mcp-protocol-version": "2025-11-25" };
  const list = await (await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, headers)).json();
  const names = list.result.tools.map((tool: { name: string }) => tool.name).sort();
  assert.deepEqual(names, [
    "compare_fixes",
    "describe_building",
    "find_way_out",
    "forget_occupant",
    "get_drill_result",
    "get_warden_playbook",
    "list_safety_fixes",
    "plan_evacuation",
    "register_occupant",
    "run_drill",
    "smoke_forecast",
    "start_drill",
  ]);
  const runDrill = list.result.tools.find((tool: { name: string }) => tool.name === "run_drill");
  assert.equal(runDrill.execution.taskSupport, "required");

  const call = await (
    await rpc(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "find_way_out", arguments: { room: "Library", step_free: true } } },
      headers,
    )
  ).json();
  assert.equal(call.result.isError, undefined);
  assert.equal(call.result.structuredContent.action, "evacuate");
  assert.match(call.result.content[0].text, /^From the Library/);

  const bad = await (
    await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "find_way_out", arguments: { room: "Swimming Pool" } } }, headers)
  ).json();
  assert.equal(bad.result.isError, true);
});

test("browser origins are refused unless allowed, and GET is not offered", async () => {
  const res = await rpc({ jsonrpc: "2.0", id: 5, method: "tools/list" }, { origin: "https://evil.example" });
  assert.equal(res.status, 403);
  assert.equal((await GET()).status, 405);
});

test("drill tools refuse what they cannot run, without spending anything", async () => {
  const headers = { "mcp-protocol-version": "2025-11-25" };
  const call = async (name: string, args: Record<string, unknown>) =>
    (await (await rpc({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name, arguments: args } }, headers)).json()).result;

  const nowhere = await call("start_drill", { fire_room: "Entrance" });
  assert.equal(nowhere.isError, true);
  assert.match(nowhere.content[0].text, /Drills can start a fire in: .*Cafeteria/);

  const missing = await call("get_drill_result", { drill_id: "drill-nope" });
  assert.equal(missing.isError, true);

  const early = await call("compare_fixes", { drill_id: "drill-nope", fixes: ["ramp"] });
  assert.equal(early.isError, true);

  // no id, or "latest", means the most recent drill; with none run yet, say so plainly
  for (const args of [{}, { drill_id: "latest" }]) {
    const none = await call("get_drill_result", args);
    assert.equal(none.isError, true);
    assert.match(none.content[0].text, /No drill has been run yet/);
  }
});
