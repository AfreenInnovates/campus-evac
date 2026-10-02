import { NextResponse } from "next/server";
import type { DrillSummary, ObjectiveSplit } from "@/app/simulation/report";
import { FROM, identityState, parkReport, sendReport, startVerification } from "./pending";

export const runtime = "nodejs";

/**
 * Requests a drill report by email.
 *
 * Verified addresses are mailed straight away. Anything else starts SES verification and
 * parks the run, because the sandbox refuses unverified recipients; `/api/report/status`
 * then delivers it once the address is confirmed.
 *
 * The scoring is recomputed here from the posted measurements rather than trusted from the
 * page, so the mail always reflects the same function.
 */

// Deliberately permissive: SES is the real validator, this only catches obvious typos.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const num = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

function parseSummary(input: unknown): DrillSummary | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;

  const splits: ObjectiveSplit[] = Array.isArray(raw.splits)
    ? raw.splits.slice(0, 12).map((item) => {
        const split = (item ?? {}) as Record<string, unknown>;
        return {
          id: String(split.id ?? "") as ObjectiveSplit["id"],
          label: String(split.label ?? "Objective").slice(0, 80),
          room: String(split.room ?? "").slice(0, 80),
          seconds: typeof split.seconds === "number" && Number.isFinite(split.seconds) ? split.seconds : null,
        };
      })
    : [];

  const mistakes = Array.isArray(raw.mistakes)
    ? raw.mistakes.slice(0, 20).map((item) => {
        const mistake = (item ?? {}) as Record<string, unknown>;
        return { at: num(mistake.at), text: String(mistake.text ?? "Invalid action").slice(0, 120) };
      })
    : [];

  return {
    outcome: raw.outcome === "escaped" ? "escaped" : "failed",
    durationSeconds: Math.max(0, num(raw.durationSeconds)),
    objectivesCompleted: Math.max(0, Math.round(num(raw.objectivesCompleted))),
    objectivesTotal: Math.max(1, Math.round(num(raw.objectivesTotal, 6))),
    splits,
    mistakes,
    health: num(raw.health),
    lowestAir: num(raw.lowestAir, 100),
    routeMessageAt: typeof raw.routeMessageAt === "number" ? raw.routeMessageAt : null,
    interventionApplied: raw.interventionApplied === true,
    roomCode: typeof raw.roomCode === "string" ? raw.roomCode.slice(0, 12) : null,
  };
}

export async function POST(request: Request) {
  if (!FROM)
    return NextResponse.json({ error: "Reports are not configured: set REPORT_FROM_EMAIL." }, { status: 503 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request" }, { status: 400 });
  }

  const { email, summary } = (body ?? {}) as { email?: unknown; summary?: unknown };
  const to = typeof email === "string" ? email.trim() : "";
  if (!EMAIL.test(to)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });

  const parsed = parseSummary(summary);
  if (!parsed) return NextResponse.json({ error: "Unrecognised drill summary" }, { status: 400 });

  try {
    const state = await identityState(to);

    if (state === "verified") {
      const sent = await sendReport(to, parsed);
      return NextResponse.json({ status: "sent", ...sent });
    }

    // Park first: if verification starts but the write fails, the click would find nothing.
    await parkReport(to, parsed);
    await startVerification(to, state);
    return NextResponse.json({ status: "verify" });
  } catch (error) {
    // Amplify SSR has no log group here, so the AWS error name travels in the response.
    // It names the failing permission or service without leaking addresses or payloads.
    const code = error instanceof Error ? error.name : "Unknown";
    console.error("Report request failed", code, error);
    return NextResponse.json({ error: "Could not start the report. Try again.", code }, { status: 502 });
  }
}
