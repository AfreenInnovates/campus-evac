import { DynamoDBClient, QueryCommand, type AttributeValue } from "@aws-sdk/client-dynamodb";
import { NextResponse } from "next/server";
import { CRITICAL_SCENARIO_OBJECTS, type ScenarioObjectId } from "@/app/simulation/level";

export const runtime = "nodejs";

/**
 * End-of-drill sanity check.
 *
 * Reads the drill's recorded history and asks whether the run it describes is physically
 * plausible, so a session driven from the browser console is not presented as a clean
 * result. Runs once, when the drill ends — never per position update.
 *
 * What this cannot do: the history is published by the same clients it judges, so a forger
 * who emits well-spaced, correctly ordered `progress` events in real time passes every check
 * here. This catches implausible runs, not a careful cheat. Actually preventing it would
 * need a Lambda data source authorising each command on `/game/{code}/cmd` before it is
 * accepted, which is deliberately out of scope.
 *
 * Advisory only: a failure never changes the player's result or blocks the end screen, and
 * an infrastructure problem returns "unavailable" rather than an accusation.
 */

const TABLE = "campusevac-events";
/** Two consecutive objectives closer than this could not have been walked between. */
const MIN_STEP_GAP_SECONDS = 2;
/** A full run of six objectives plus the exit cannot credibly be done faster than this. */
const MIN_DURATION_SECONDS = 30;
const MAX_PROGRESS_EVENTS = 7;
const CODE_ALPHABET = /^[A-Z0-9]{4,8}$/;

type ProgressEvent = { step: ScenarioObjectId; elapsed: number; at: number };
type Verdict = {
  verified: boolean;
  reasons: string[];
  timeline: { step: ScenarioObjectId; elapsed: number }[];
};

let client: DynamoDBClient | null = null;
const dynamo = () =>
  (client ??= new DynamoDBClient({ region: process.env.EVENTS_REGION ?? process.env.AWS_REGION ?? "ap-south-1" }));

const label = (step: string) => step.replace(/-/g, " ");

/** Pulls the drill's stored messages, oldest first. A Query on the partition, never a Scan. */
async function readHistory(code: string): Promise<ProgressEvent[]> {
  const events: ProgressEvent[] = [];
  let start: Record<string, AttributeValue> | undefined;

  do {
    const page = await dynamo().send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": { S: `DRILL#${code}` } },
        ScanIndexForward: true, // ascending by sk, which is server time
        ExclusiveStartKey: start,
      }),
    );
    for (const item of page.Items ?? []) {
      const payload = item.payload?.M;
      if (!payload || payload.t?.S !== "progress") continue;
      const step = payload.step?.S;
      const elapsed = Number(payload.elapsed?.N);
      const at = Number(payload.at?.N);
      if (!step || !Number.isFinite(elapsed)) continue;
      events.push({ step: step as ScenarioObjectId, elapsed, at: Number.isFinite(at) ? at : 0 });
    }
    start = page.LastEvaluatedKey;
  } while (start);

  return events;
}

function judge(events: ProgressEvent[]): Verdict {
  const reasons: string[] = [];
  const timeline = events.map(({ step, elapsed }) => ({ step, elapsed }));

  if (events.length > MAX_PROGRESS_EVENTS) {
    reasons.push(`${events.length} steps were recorded, but the drill only has ${MAX_PROGRESS_EVENTS}`);
  }

  const seen = events.map((event) => event.step);
  const missing = CRITICAL_SCENARIO_OBJECTS.filter((id) => !seen.includes(id));
  if (missing.length) {
    reasons.push(`no record of ${missing.map(label).join(", ")}`);
  }

  // the authored order, ignoring anything that is not one of the six critical steps
  const critical = seen.filter((step): step is ScenarioObjectId => CRITICAL_SCENARIO_OBJECTS.includes(step));
  const expected = CRITICAL_SCENARIO_OBJECTS.filter((id) => critical.includes(id));
  if (critical.join(">") !== expected.join(">")) {
    reasons.push("steps were recorded out of the authored order");
  }

  for (let i = 1; i < events.length; i++) {
    const previous = events[i - 1];
    const current = events[i];
    if (current.elapsed <= previous.elapsed) {
      reasons.push(`${label(current.step)} is timed at or before ${label(previous.step)}`);
      continue;
    }
    const gap = current.elapsed - previous.elapsed;
    if (gap < MIN_STEP_GAP_SECONDS) {
      reasons.push(`${label(previous.step)} and ${label(current.step)} completed ${gap.toFixed(1)}s apart`);
    }
  }

  const exitIndex = seen.indexOf("main-exit");
  if (exitIndex >= 0 && exitIndex !== seen.length - 1) {
    reasons.push("the exit was recorded before every step was finished");
  }

  const duration = events.length ? events[events.length - 1].elapsed : 0;
  if (duration < MIN_DURATION_SECONDS) {
    reasons.push(`the whole drill lasted ${duration.toFixed(1)}s, which is faster than the route allows`);
  }

  return { verified: reasons.length === 0, reasons, timeline };
}

export async function GET(_request: Request, context: RouteContext<"/api/verify/[code]">) {
  const { code } = await context.params;
  if (!CODE_ALPHABET.test(code)) {
    return NextResponse.json({ error: "Invalid drill code" }, { status: 400 });
  }

  try {
    const events = await readHistory(code);
    if (!events.length) {
      // nothing recorded is an infrastructure or configuration story, not a failed drill
      return NextResponse.json({ error: "No history for this drill" }, { status: 404 });
    }
    return NextResponse.json(judge(events));
  } catch (error) {
    console.error("verify: history unavailable", error);
    return NextResponse.json({ error: "Verification unavailable" }, { status: 503 });
  }
}
