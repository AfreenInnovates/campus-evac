import type { DrillReport } from "@/app/simulation/report";
import { formatClock } from "@/app/simulation/report";

/** Inline styles only: mail clients strip <style> blocks and have no CSS variables. */
const INK = "#16111e";
const PAPER = "#fdf7ed";
const SUN = "#f5a524";
const MINT = "#10b981";
const CORAL = "#ff6a3d";

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderText(report: DrillReport) {
  const { summary } = report;
  const splits = report.splits
    .map((split) => `  ${split.seconds === null ? "  --  " : formatClock(split.seconds).padStart(6)}  ${split.label}`)
    .join("\n");
  const lines = report.lines
    .map((line) => `  ${String(line.points).padStart(3)} / ${line.max}  ${line.label} - ${line.note}`)
    .join("\n");
  return [
    "CAMPUSEVAC - DRILL REPORT",
    "",
    report.headline,
    `Score ${report.score}/100 (${report.band})`,
    "",
    `Time          ${formatClock(summary.durationSeconds)}`,
    `Objectives    ${summary.objectivesCompleted}/${summary.objectivesTotal}`,
    `Errors        ${summary.mistakes.length}`,
    `Health left   ${Math.round(summary.health)}%`,
    `Lowest air    ${Math.round(summary.lowestAir)}%`,
    "",
    "SPLITS",
    splits,
    "",
    "SCORING",
    lines,
    "",
    "WHAT THE RUN SHOWS",
    report.findings.map((finding) => `  - ${finding}`).join("\n"),
    "",
    summary.roomCode ? `Drill room ${summary.roomCode}` : "Solo practice",
    "This report was generated from your own drill record.",
  ].join("\n");
}

export function renderHtml(report: DrillReport) {
  const { summary } = report;

  const stat = (label: string, value: string) => `
    <td style="padding:12px 14px;border:2px solid ${INK};background:${PAPER};">
      <div style="font:700 9px/1 Helvetica,Arial,sans-serif;letter-spacing:.18em;text-transform:uppercase;color:#6b6472;">${label}</div>
      <div style="margin-top:6px;font:900 22px/1 'Courier New',monospace;color:${INK};">${value}</div>
    </td>`;

  const splitRows = report.splits
    .map((split, index) => {
      const done = split.seconds !== null;
      return `
      <tr>
        <td style="padding:7px 10px;border-bottom:1px solid #e3dccf;font:700 11px/1.3 Helvetica,Arial,sans-serif;color:#6b6472;width:24px;">${index + 1}</td>
        <td style="padding:7px 10px;border-bottom:1px solid #e3dccf;font:${done ? 700 : 400} 13px/1.3 Helvetica,Arial,sans-serif;color:${done ? INK : "#9b93a3"};">
          ${escape(split.label)}<span style="color:#9b93a3;font-weight:400;"> &middot; ${escape(split.room.split(" / ").pop() ?? "")}</span>
        </td>
        <td style="padding:7px 10px;border-bottom:1px solid #e3dccf;text-align:right;font:900 13px/1.3 'Courier New',monospace;color:${done ? MINT : CORAL};">
          ${done ? formatClock(split.seconds as number) : "missed"}
        </td>
      </tr>`;
    })
    .join("");

  const scoreRows = report.lines
    .map(
      (line) => `
      <tr>
        <td style="padding:7px 10px;border-bottom:1px solid #e3dccf;font:700 13px/1.3 Helvetica,Arial,sans-serif;color:${INK};">
          ${escape(line.label)}
          <div style="margin-top:2px;font:400 11px/1.4 Helvetica,Arial,sans-serif;color:#6b6472;">${escape(line.note)}</div>
        </td>
        <td style="padding:7px 10px;border-bottom:1px solid #e3dccf;text-align:right;white-space:nowrap;font:900 13px/1.3 'Courier New',monospace;color:${line.points < 0 ? CORAL : INK};">
          ${line.points > 0 ? "+" : ""}${line.points}${line.max ? `<span style="color:#9b93a3;font-weight:400;">/${line.max}</span>` : ""}
        </td>
      </tr>`,
    )
    .join("");

  const findings = report.findings
    .map(
      (finding) => `
      <li style="margin:0 0 8px;padding-left:10px;border-left:4px solid ${SUN};font:400 13px/1.5 Helvetica,Arial,sans-serif;color:${INK};list-style:none;">
        ${escape(finding)}
      </li>`,
    )
    .join("");

  return `<!doctype html>
<html><body style="margin:0;padding:24px 12px;background:#efe7db;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;width:100%;">
    <tr><td style="border:3px solid ${INK};background:${PAPER};padding:24px;">

      <div style="display:inline-block;padding:4px 10px;border:2px solid ${INK};background:${report.summary.outcome === "escaped" ? MINT : CORAL};font:900 10px/1 Helvetica,Arial,sans-serif;letter-spacing:.18em;text-transform:uppercase;color:${INK};">
        Drill report
      </div>

      <h1 style="margin:14px 0 4px;font:900 30px/1 Helvetica,Arial,sans-serif;letter-spacing:-.03em;color:${INK};">
        ${escape(report.headline)}
      </h1>
      <div style="font:700 13px/1.4 Helvetica,Arial,sans-serif;color:#6b6472;">
        Score <b style="color:${INK};">${report.score}/100</b> &middot; ${escape(report.band)}
      </div>

      <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:18px;width:100%;border-collapse:collapse;">
        <tr>${stat("Time", formatClock(summary.durationSeconds))}${stat("Objectives", `${summary.objectivesCompleted}/${summary.objectivesTotal}`)}${stat("Errors", String(summary.mistakes.length))}</tr>
        <tr>${stat("Health left", `${Math.round(summary.health)}%`)}${stat("Lowest air", `${Math.round(summary.lowestAir)}%`)}${stat("Warden msg", summary.routeMessageAt === null ? "none" : formatClock(summary.routeMessageAt))}</tr>
      </table>

      <h2 style="margin:24px 0 6px;font:900 11px/1 Helvetica,Arial,sans-serif;letter-spacing:.18em;text-transform:uppercase;color:#6b6472;">Objective splits</h2>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border:2px solid ${INK};">${splitRows}</table>

      <h2 style="margin:24px 0 6px;font:900 11px/1 Helvetica,Arial,sans-serif;letter-spacing:.18em;text-transform:uppercase;color:#6b6472;">How the score was reached</h2>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border:2px solid ${INK};">${scoreRows}</table>

      <h2 style="margin:24px 0 8px;font:900 11px/1 Helvetica,Arial,sans-serif;letter-spacing:.18em;text-transform:uppercase;color:#6b6472;">What the run shows</h2>
      <ul style="margin:0;padding:0;">${findings}</ul>

      <p style="margin:24px 0 0;padding-top:14px;border-top:2px solid ${INK};font:400 11px/1.5 Helvetica,Arial,sans-serif;color:#6b6472;">
        ${summary.roomCode ? `Drill room <b style="color:${INK};">${escape(summary.roomCode)}</b>.` : "Solo practice."}
        Every figure above was measured during your drill. You received this because you asked for it at the end of the run.
      </p>

    </td></tr>
  </table>
</body></html>`;
}
