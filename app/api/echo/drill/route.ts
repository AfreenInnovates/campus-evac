import { NextResponse } from "next/server";
import { getDrill } from "@/app/mcp/drills";

export const runtime = "nodejs";

/**
 * Whether a drill the Echo page started has finished, so the device can light up the way an
 * Echo does for a notification. Only the status: the result itself is asked for by voice.
 */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^drill-[a-z0-9-]{4,40}$/.test(id)) return NextResponse.json({ error: "Unknown drill" }, { status: 400 });
  const record = await getDrill(id);
  return record ? NextResponse.json({ status: record.status }) : NextResponse.json({ error: "Unknown drill" }, { status: 404 });
}
