import { NextResponse } from "next/server";
import type { CrowdTask } from "@/app/simulation/crowd/prompts";
import { runTask, TASKS } from "./nebius";

export const runtime = "nodejs";

/**
 * Every model call the Crowd Lab makes from the browser goes through here, so the Nebius key
 * never reaches the browser and each task can only run its own fixed system prompt on its own
 * model (see ./nebius).
 */

/* a coarse per-address budget, so a public demo cannot be used to burn the credits */
const WINDOW_MS = 60_000;
const BUDGET = 240;
const spend = new Map<string, { start: number; count: number }>();
function allowed(address: string) {
  const now = Date.now();
  const entry = spend.get(address);
  if (!entry || now - entry.start > WINDOW_MS) {
    spend.set(address, { start: now, count: 1 });
    return true;
  }
  entry.count++;
  return entry.count <= BUDGET;
}

export async function POST(request: Request) {
  const key = process.env.NEBIUS_API_KEY;
  if (!key) return NextResponse.json({ error: "NEBIUS_API_KEY is not set" }, { status: 503 });

  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowed(address)) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: { task?: string; input?: string; image?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request" }, { status: 400 });
  }
  const task = body.task as CrowdTask;
  if (!TASKS.includes(task)) return NextResponse.json({ error: "Unknown task" }, { status: 400 });
  const input = typeof body.input === "string" ? body.input.slice(0, 24_000) : "";
  const image = typeof body.image === "string" && body.image.startsWith("data:image/") ? body.image : null;
  if (task === "warden-see" && !image) return NextResponse.json({ error: "Missing image" }, { status: 400 });
  if (image && image.length > 3_000_000) return NextResponse.json({ error: "Image too large" }, { status: 413 });

  const { status, body: reply } = await runTask(task, input, image);
  return NextResponse.json(reply, { status });
}
