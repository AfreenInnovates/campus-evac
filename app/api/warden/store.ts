import { DynamoDBClient, GetItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import type { Playbook, TrainingPoint } from "@/app/simulation/crowd/playbook";

/**
 * Where the shared warden lives in DynamoDB, for /api/warden and for the MCP server alike.
 *
 * Rows live in the existing events table under their own partition:
 *   pk "warden", sk "playbook"            the current playbook
 *   pk "warden", sk "point#<drill>#<at>"  one row per drill on the learning curve
 */

const REGION = process.env.WARDEN_REGION?.trim() || process.env.SES_REGION?.trim() || process.env.AWS_REGION?.trim() || "ap-south-1";
export const TABLE = process.env.WARDEN_TABLE?.trim() || process.env.REPORTS_TABLE?.trim() || "campusevac-events";
export const PK = { S: "warden" };
const MAX_POINTS = 200;

/** MCP_STORE=memory keeps drills and occupants out of DynamoDB: for tests, which must never write real rows. */
export const persistent = () => process.env.MCP_STORE !== "memory";

let client: DynamoDBClient | null = null;
export const db = () => (client ??= new DynamoDBClient({ region: REGION }));

/** The current playbook and every drill on the learning curve. */
export async function readShared(): Promise<{ playbook: Playbook | null; history: TrainingPoint[] }> {
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
  return {
    playbook: playbook.Item?.data?.S ? JSON.parse(playbook.Item.data.S) : null,
    history: (points.Items ?? []).map((item) => JSON.parse(item.data?.S ?? "null")).filter(Boolean),
  };
}
