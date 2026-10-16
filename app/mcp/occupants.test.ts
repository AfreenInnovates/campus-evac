import { test } from "node:test";
import assert from "node:assert/strict";
import { POST } from "../api/mcp/route.ts";

// never write test rows into the real DynamoDB table, even on a machine with AWS access
process.env.MCP_STORE = "memory";

const call = async (name: string, args: Record<string, unknown>) => {
  const res = await POST(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-11-25" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    }),
  );
  return (await res.json()).result;
};

test("a registered wheelchair user is routed step-free without saying so again", async () => {
  const saved = await call("register_occupant", { name: "Fatima", room: "library", needs: ["wheelchair"] });
  assert.match(saved.content[0].text, /Fatima, usually in the Library, uses a wheelchair/);

  const anyone = await call("find_way_out", { room: "library" });
  assert.equal(anyone.structuredContent.route.exit, "West Fire Exit");

  // no room given: her usual one; no step_free given: her needs
  const fatima = await call("find_way_out", { person: "fatima" });
  assert.equal(fatima.structuredContent.from, "Library");
  assert.notEqual(fatima.structuredContent.route.exit, "West Fire Exit");
  assert.equal(fatima.structuredContent.route.step_free, true);
});

test("a deaf occupant's directions are flagged for a screen; a blind one gets doorways to count", async () => {
  await call("register_occupant", { name: "Kofi", room: "computer lab", needs: ["deaf"] });
  const kofi = await call("find_way_out", { person: "Kofi" });
  assert.equal(kofi.structuredContent.show_on_screen, true);

  await call("register_occupant", { name: "Rosa", room: "cafeteria", needs: ["blind"] });
  const rosa = await call("find_way_out", { person: "Rosa" });
  assert.match(rosa.content[0].text, /keep a hand on the wall and count them/);
});

test("the whole-building plan carries everyone's personal plan", async () => {
  const plan = await call("plan_evacuation", { fire_room: "cafeteria", seconds_since_fire: 30 });
  const names = plan.structuredContent.personal_plans.map((p: { name: string }) => p.name);
  assert.ok(names.includes("Fatima") && names.includes("Kofi"));
  assert.match(plan.content[0].text, /Personal plans: .*Fatima in the Library/);
});

test("forgetting deletes, and an unknown name is refused rather than guessed", async () => {
  const gone = await call("forget_occupant", { name: "Fatima" });
  assert.equal(gone.structuredContent.forgotten, true);
  const after = await call("find_way_out", { person: "Fatima" });
  assert.equal(after.isError, true);
  assert.match(after.content[0].text, /Nobody called Fatima is registered/);
});
