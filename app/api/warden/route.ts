import { DeleteItemCommand, GetItemCommand, PutItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { NextResponse } from "next/server";
import { db, PK, readShared, TABLE } from "./store";

export const runtime = "nodejs";

/**
 * The warden's shared memory: one playbook and its training history, so everyone who opens
 * the Crowd Lab meets the same trained warden. Where the rows live is in ./store.
 *
 * Anyone can read. Writing needs WARDEN_ADMIN_KEY when it is set, so a visitor cannot
 * retrain or wipe the warden that judges are about to look at.
 */

const ADMIN_KEY = process.env.WARDEN_ADMIN_KEY?.trim() ?? "";

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
    return NextResponse.json({
      ...(await readShared()),
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
