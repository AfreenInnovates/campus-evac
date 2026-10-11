import { test } from "node:test";
import assert from "node:assert/strict";
import { FIXES, fixById, hasFix } from "./fixes.ts";

test("every fix id is unique and resolvable", () => {
  const ids = FIXES.map((fix) => fix.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.equal(fixById(id).id, id);
});

test("hasFix tolerates a missing list", () => {
  assert.equal(hasFix(undefined, "ramp"), false);
  assert.equal(hasFix(["ramp"], "ramp"), true);
  assert.equal(hasFix(["strobes"], "ramp"), false);
});
