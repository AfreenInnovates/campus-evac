import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  CreateEmailIdentityCommand,
  DeleteEmailIdentityCommand,
  GetEmailIdentityCommand,
  SendEmailCommand,
  SESv2Client,
} from "@aws-sdk/client-sesv2";
import { DeleteItemCommand, GetItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { buildReport, type DrillSummary } from "@/app/simulation/report";
import { renderHtml, renderText } from "./email";

/**
 * Holding pen for reports whose recipient has not verified yet.
 *
 * SES will not deliver to an unverified address while the account is in the sandbox, so a
 * request for an unknown address starts the verification and parks the drill summary here.
 * The status route replays it once SES reports the identity verified.
 *
 * Rows share the existing events table and expire on the same 24 hour clock as the AWS
 * verification link, so an abandoned request cleans itself up.
 */

const REGION = process.env.SES_REGION?.trim() ?? process.env.AWS_REGION?.trim() ?? "ap-south-1";
const TABLE = process.env.REPORTS_TABLE?.trim() || "campusevac-events";
export const FROM = process.env.REPORT_FROM_EMAIL?.trim() ?? "";

const PENDING_TTL_SECONDS = 24 * 60 * 60;

let ses: SESv2Client | null = null;
let ddb: DynamoDBClient | null = null;
const mail = () => (ses ??= new SESv2Client({ region: REGION }));
const table = () => (ddb ??= new DynamoDBClient({ region: REGION }));

const key = (email: string) => ({
  pk: { S: `report#${email.toLowerCase()}` },
  sk: { S: "pending" },
});

export type IdentityState = "verified" | "pending" | "missing";

export async function identityState(email: string): Promise<IdentityState> {
  try {
    const identity = await mail().send(new GetEmailIdentityCommand({ EmailIdentity: email }));
    return identity.VerifiedForSendingStatus ? "verified" : "pending";
  } catch (error) {
    if (error instanceof Error && error.name === "NotFoundException") return "missing";
    throw error;
  }
}

/**
 * Starts (or restarts) verification for an address.
 *
 * SESv2 has no resend: creating an identity that already exists fails, so an address still
 * sitting unverified is removed first. That is what makes a second attempt actually send a
 * fresh link instead of silently doing nothing.
 */
export async function startVerification(email: string, state: IdentityState) {
  if (state === "pending")
    await mail()
      .send(new DeleteEmailIdentityCommand({ EmailIdentity: email }))
      .catch(() => undefined);
  await mail().send(new CreateEmailIdentityCommand({ EmailIdentity: email }));
}

export async function parkReport(email: string, summary: DrillSummary) {
  await table().send(
    new PutItemCommand({
      TableName: TABLE,
      Item: {
        ...key(email),
        summary: { S: JSON.stringify(summary) },
        createdAt: { N: String(Date.now()) },
        ttl: { N: String(Math.floor(Date.now() / 1000) + PENDING_TTL_SECONDS) },
      },
    }),
  );
}

export async function takeParkedReport(email: string): Promise<DrillSummary | null> {
  const found = await table().send(new GetItemCommand({ TableName: TABLE, Key: key(email) }));
  const raw = found.Item?.summary?.S;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DrillSummary;
  } catch {
    return null;
  }
}

export async function clearParkedReport(email: string) {
  await table()
    .send(new DeleteItemCommand({ TableName: TABLE, Key: key(email) }))
    .catch(() => undefined);
}

export async function sendReport(email: string, summary: DrillSummary) {
  const report = buildReport(summary);
  const sent = await mail().send(
    new SendEmailCommand({
      FromEmailAddress: FROM,
      Destination: { ToAddresses: [email] },
      Content: {
        Simple: {
          Subject: { Data: report.subject, Charset: "UTF-8" },
          Body: {
            Html: { Data: renderHtml(report), Charset: "UTF-8" },
            Text: { Data: renderText(report), Charset: "UTF-8" },
          },
        },
      },
    }),
  );
  return { messageId: sent.MessageId, score: report.score };
}
