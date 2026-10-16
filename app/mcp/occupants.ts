import { DeleteItemCommand, GetItemCommand, PutItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { db, persistent, TABLE } from "../api/warden/store";
import type { RoomId } from "../simulation/crowd/world";
import type { Advice } from "./evac";

/**
 * People who have told the building what they need in an evacuation, the way a Personal
 * Emergency Evacuation Plan (PEEP) records it: a first name, the room they are usually in, and
 * their needs. Routes for them then fit them without being asked again.
 *
 * Only what a route needs is kept, and `forget` removes it. Records live in memory and, when
 * AWS is reachable, in the events table under their own partition.
 */

export const NEEDS = ["wheelchair", "cannot_use_stairs", "deaf", "blind", "elderly", "visitor"] as const;
export type Need = (typeof NEEDS)[number];

export interface Occupant {
  name: string;
  room: RoomId | null;
  needs: Need[];
  updatedAt: number;
}

const PK = { S: "occupant" };
/** Kept on globalThis so a module reload (Next.js in development) does not forget anyone. */
const memory = ((globalThis as { __campusevacOccupants?: Map<string, Occupant> }).__campusevacOccupants ??= new Map());
const keyOf = (name: string) => name.trim().toLowerCase();

export const stepFreeFor = (occupant: Occupant | null) => !!occupant?.needs.some((need) => need === "wheelchair" || need === "cannot_use_stairs");

export async function saveOccupant(occupant: Occupant) {
  memory.set(keyOf(occupant.name), occupant);
  if (!persistent()) return;
  try {
    await db().send(new PutItemCommand({ TableName: TABLE, Item: { pk: PK, sk: { S: keyOf(occupant.name) }, data: { S: JSON.stringify(occupant) } } }));
  } catch {
    /* no AWS here: memory only */
  }
}

export async function findOccupant(name: string): Promise<Occupant | null> {
  const local = memory.get(keyOf(name));
  if (local || !persistent()) return local ?? null;
  try {
    const item = await db().send(new GetItemCommand({ TableName: TABLE, Key: { pk: PK, sk: { S: keyOf(name) } } }));
    return item.Item?.data?.S ? (JSON.parse(item.Item.data.S) as Occupant) : null;
  } catch {
    return null;
  }
}

export async function forgetOccupant(name: string) {
  const known = memory.delete(keyOf(name));
  if (!persistent()) return known;
  try {
    await db().send(new DeleteItemCommand({ TableName: TABLE, Key: { pk: PK, sk: { S: keyOf(name) } } }));
    return true;
  } catch {
    return known;
  }
}

export async function allOccupants(): Promise<Occupant[]> {
  if (!persistent()) return [...memory.values()];
  try {
    const rows = await db().send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: "pk = :pk", ExpressionAttributeValues: { ":pk": PK }, Limit: 200 }));
    const stored = (rows.Items ?? []).map((item) => JSON.parse(item.data?.S ?? "null") as Occupant | null).filter((o): o is Occupant => !!o);
    for (const o of stored) memory.set(keyOf(o.name), o);
  } catch {
    /* memory only */
  }
  return [...memory.values()];
}

/** The needs in words, for a sentence: "uses a wheelchair and is deaf". */
export function needsSaid(needs: Need[]) {
  const words: Record<Need, string> = {
    wheelchair: "uses a wheelchair",
    cannot_use_stairs: "cannot use stairs",
    deaf: "is deaf",
    blind: "is blind",
    elderly: "is elderly",
    visitor: "is a visitor",
  };
  const list = needs.map((need) => words[need]);
  return list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : (list[0] ?? "has no special needs");
}

/**
 * Directions fitted to one person: no crawling for someone who cannot get down, doorways to
 * count for someone who cannot see the signs, and a flag to show the words on a screen for
 * someone who cannot hear them.
 */
export function personalise(advice: Advice, occupant: Occupant | null) {
  let speech = advice.speech;
  const needs = new Set(occupant?.needs ?? []);
  if (needs.has("wheelchair") || needs.has("elderly"))
    speech = speech.replace(/ Crawl under the smoke, it is thick on the way\.| Stay low under the smoke\./, " Keep as low as you safely can and cover your mouth and nose.");
  if (needs.has("blind") && advice.action === "evacuate")
    speech += ` The way out is ${advice.route.doorways} ${advice.route.doorways === 1 ? "doorway" : "doorways"} from where you are: keep a hand on the wall and count them.`;
  return { speech, show_on_screen: needs.has("deaf") };
}
