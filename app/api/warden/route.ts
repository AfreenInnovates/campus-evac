import { DeleteItemCommand, DynamoDBClient, GetItemCommand, PutItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * The warden's shared memory: one playbook and its training history, so everyone who opens
 * the Crowd Lab meets the same trained warden.
 *
 * Rows live in the existing events table under their own partition:
 *   pk "warden", sk "playbook"            the current playbook
 *   pk "warden", sk "point#<drill>#<at>"  one row per drill on the learning curve
 *
 * Anyone can read. Writing needs WARDEN_ADMIN_KEY when it is set, so a visitor cannot
 * retrain or wipe the warden that judges are about to look at.
 */

const REGION = process.env.WARDEN_REGION?.trim() || process.env.SES_REGION?.trim() || process.env.AWS_REGION?.trim() || "ap-south-1";
const TABLE = process.env.WARDEN_TABLE?.trim() || process.env.REPORTS_TABLE?.trim() || "campusevac-events";
const ADMIN_KEY = process.env.WARDEN_ADMIN_KEY?.trim() ?? "";
const PK = { S: "warden" };
const MAX_POINTS = 200;

let client: DynamoDBClient | null = null;
const db = () => (client ??= new DynamoDBClient({ region: REGION }));

const drillKey = (drill: unknown) => String(Math.max(0, Math.floor(Number(drill) || 0))).padStart(5, "0");

const fail = (error: unknown, status = 503) =>
  NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });

export async function GET(request: Request) {
  // one recorded training drill
  const drill = new URL(request.url).searchParams.get("replay");
  if (drill !== null) {
    try {
      const item = await db().send(new GetItemCommand({ TableName: TABLE, Key: { pk: PK, sk: { S: `replay#${drillKey(drill)}` } } }));
      return item.Item?.data?.S ? NextResponse.json({ data: item.Item.data.S }) : NextResponse.json({ error: "No replay" }, { status: 404 });
    } catch (error) {
      return fail(error);
    }
  }
  try {
    const [playbook, points] = await Promise.all([
      db().send(new GetItemCommand({ TableName: TABLE, Key: { pk: PK, sk: { S: "playbook" } } })),
      db().send(
        new QueryCommand({
          TableName: TABLE,
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :point)",
          ExpressionAttributeValues: { ":pk": PK, ":point": { S: "point#" } },
          Limit: MAX_POINTS,
        }),
      ),
    ]);
    return NextResponse.json({
      playbook: playbook.Item?.data?.S ? JSON.parse(playbook.Item.data.S) : null,
      history: (points.Items ?? []).map((item) => JSON.parse(item.data?.S ?? "null")).filter(Boolean),
      locked: !!ADMIN_KEY,
    });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  if (ADMIN_KEY && request.headers.get("x-warden-key") !== ADMIN_KEY)
    return NextResponse.json({ error: "Only the lab owner can train the shared warden" }, { status: 403 });

  let body: { type?: string; playbook?: unknown; point?: { drill?: number; at?: number }; drill?: number; data?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request" }, { status: 400 });
  }
  const text = (value: unknown) => {
    const json = JSON.stringify(value);
    if (json.length > 20_000) throw new Error("Too large");
    return json;
  };

  try {
    if (body.type === "playbook" && body.playbook) {
      await db().send(new PutItemCommand({ TableName: TABLE, Item: { pk: PK, sk: { S: "playbook" }, data: { S: text(body.playbook) } } }));
    } else if (body.type === "point" && body.point) {
      const sk = `point#${drillKey(body.point.drill)}#${Number(body.point.at) || Date.now()}`;
      await db().send(new PutItemCommand({ TableName: TABLE, Item: { pk: PK, sk: { S: sk }, data: { S: text(body.point) } } }));
    } else if (body.type === "replay" && typeof body.data === "string") {
      // gzip + base64 from the browser; DynamoDB items stop at 400 KB
      if (body.data.length > 350_000) throw new Error("Too large");
      await db().send(new PutItemCommand({ TableName: TABLE, Item: { pk: PK, sk: { S: `replay#${drillKey(body.drill)}` }, data: { S: body.data } } }));
    } else if (body.type === "reset") {
      const rows = await db().send(
        new QueryCommand({ TableName: TABLE, KeyConditionExpression: "pk = :pk", ExpressionAttributeValues: { ":pk": PK }, ProjectionExpression: "pk, sk" }),
      );
      await Promise.all((rows.Items ?? []).map((item) => db().send(new DeleteItemCommand({ TableName: TABLE, Key: { pk: item.pk, sk: item.sk } }))));
    } else {
      return NextResponse.json({ error: "Unknown write" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fail(error, error instanceof Error && error.message === "Too large" ? 413 : 503);
  }
}
