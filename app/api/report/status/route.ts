import { NextResponse } from "next/server";
import {
  clearParkedReport,
  identityState,
  sendReport,
  takeParkedReport,
} from "../pending";

export const runtime = "nodejs";

/**
 * Polled by the end card while the participant confirms their address.
 *
 * Returns `pending` until SES reports the identity verified, then sends the parked run and
 * returns `sent`. The parked row is removed before the send is reported so a slow poll
 * cannot mail the same report twice.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function GET(request: Request) {
  const email = new URL(request.url).searchParams.get("email")?.trim() ?? "";
  if (!EMAIL.test(email)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });

  try {
    if ((await identityState(email)) !== "verified") return NextResponse.json({ status: "pending" });

    const summary = await takeParkedReport(email);
    // Verified with nothing parked: the report already went out on an earlier poll.
    if (!summary) return NextResponse.json({ status: "sent" });

    const sent = await sendReport(email, summary);
    await clearParkedReport(email);
    return NextResponse.json({ status: "sent", ...sent });
  } catch (error) {
    const code = error instanceof Error ? error.name : "Unknown";
    console.error("Report status check failed", code, error);
    return NextResponse.json({ error: "Could not check verification.", code }, { status: 502 });
  }
}
