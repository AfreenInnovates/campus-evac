import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { readShared } from "../api/warden/store";
import { placeName, type RoomId } from "../simulation/crowd/world";
import { registerDrillTools } from "./drill-tools";
import { allOccupants, findOccupant, forgetOccupant, NEEDS, needsSaid, personalise, saveOccupant, stepFreeFor } from "./occupants";
import { DrillTaskStore } from "./tasks";
import { answer, READ_ONLY, refuse } from "./reply";
import { adviseRoute, DEFAULT_SECONDS, describeBuilding, everyRoom, planEvacuation, resolveRoom, safetyFixes, smokeForecast, type Fire } from "./evac";

/**
 * CampusEvac as an MCP server, so Alexa+ (or any MCP client) can ask the building the same
 * questions the Crowd Lab's warden reasons over. Every tool answers with a sentence meant
 * to be spoken, followed by the same answer as JSON for an agent to reason on. All of them only
 * read, except the drill tools (./drill-tools), which run a simulated drill.
 */

const INSTRUCTIONS = [
  "CampusEvac knows one campus building: its rooms, doorways, signs and fire exits, how smoke from a fire spreads through it, and a fire warden playbook learned from AI-run fire drills.",
  "Use it to plan and rehearse evacuations, run what-if drills, and answer 'which way out from here?'.",
  "Read the `speech` text aloud as it is: it uses compass directions and doorway signs, never left or right, because a person in smoke has no map and no facing.",
  "If the person says there is a real fire now, tell them first to leave or shelter as the tool says and to call the local emergency number. This tool is a planning and drill aid, not a replacement for the building's alarm or the fire service.",
].join("\n");

const roomList = () => describeBuilding().rooms.map((room) => room.name).join(", ");

/** A room or a polite error naming the rooms there are. */
export function room(text: string): RoomId | CallToolResult {
  return resolveRoom(text) ?? refuse(`There is no room called "${text}" in this building. The rooms are: ${roomList()}.`);
}

function fireFrom(fireRoom: string | undefined, seconds: number | undefined): Fire | null | CallToolResult {
  if (!fireRoom) return null;
  const found = room(fireRoom);
  return typeof found === "string" ? { room: found, seconds: seconds ?? DEFAULT_SECONDS } : found;
}

const fireArgs = {
  fire_room: z.string().optional().describe("The room the fire is in, by name (e.g. \"Cafeteria\", \"the library\"). Leave out if unknown."),
  seconds_since_fire: z
    .number()
    .min(0)
    .max(900)
    .optional()
    .describe(`How many seconds since the fire started; smoke spreads with time. Defaults to ${DEFAULT_SECONDS}.`),
};

export function createServer() {
  const server = new McpServer(
    { name: "campusevac", title: "CampusEvac", version: "0.1.0" },
    {
      instructions: INSTRUCTIONS,
      // long drills can be run as MCP Tasks: started now, polled for, fetched when done
      capabilities: { tasks: { requests: { tools: { call: {} } } } },
      taskStore: new DrillTaskStore(),
    },
  );

  server.registerTool(
    "describe_building",
    {
      title: "Describe the building",
      description: "List the building's rooms, its fire exits (and which are step-free), and the fire scenarios drills are run on.",
      annotations: READ_ONLY,
    },
    async () => {
      const building = describeBuilding();
      const exits = building.exits.map((e) => `the ${e.name} from the ${e.from_room}${e.step_free ? "" : ", which has steps"}`);
      return answer(`${building.building} has ${building.rooms.length} rooms and ${exits.length} ways out: ${exits.join("; ")}.`, building);
    },
  );

  server.registerTool(
    "find_way_out",
    {
      title: "Find the way out",
      description:
        "Directions out of the building from one room, avoiding the fire and the thickest smoke, or advice to shelter in place when every way out is cut off. Name a registered person to fit the route to their needs (step-free for a wheelchair, and so on); set step_free for anyone else who cannot use steps.",
      inputSchema: {
        room: z.string().optional().describe("Where the person is now, by room name (e.g. \"Computer Lab\", \"the gym\"). Defaults to a registered person's usual room."),
        person: z.string().optional().describe("The first name of someone registered with register_occupant."),
        ...fireArgs,
        step_free: z.boolean().optional().describe("True if the person cannot use steps (wheelchair, crutches, pram)."),
      },
      annotations: READ_ONLY,
    },
    async ({ room: where, person, fire_room, seconds_since_fire, step_free }) => {
      const occupant = person ? await findOccupant(person) : null;
      if (person && !occupant) return refuse(`Nobody called ${person} is registered. Register them with their needs first, or just say which room they are in.`);
      const from = where ? room(where) : (occupant?.room ?? refuse("Which room are you in?"));
      if (typeof from !== "string") return from;
      const fire = fireFrom(fire_room, seconds_since_fire);
      if (fire && "content" in fire) return fire;
      const advice = adviseRoute(from, { fire, stepFree: step_free || stepFreeFor(occupant) });
      const fitted = personalise(advice, occupant);
      return answer(fitted.speech, {
        from: placeName(from),
        fire_room: fire ? placeName(fire.room) : null,
        person: occupant ? { name: occupant.name, needs: occupant.needs } : null,
        show_on_screen: fitted.show_on_screen,
        ...advice,
        speech: fitted.speech,
      });
    },
  );

  server.registerTool(
    "register_occupant",
    {
      title: "Register someone's evacuation needs",
      description:
        "Remember a person's first name, the room they are usually in and what they need in an evacuation (a Personal Emergency Evacuation Plan), so every route for them fits. Ask before saving: this is health information. forget_occupant removes it.",
      inputSchema: {
        name: z.string().min(1).max(40).describe("First name only."),
        room: z.string().optional().describe("The room they are usually in."),
        needs: z.array(z.enum(NEEDS)).describe("What they need: wheelchair, cannot_use_stairs, deaf, blind, elderly, visitor. Empty for none."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ name, room: usual, needs }) => {
      const at = usual ? room(usual) : null;
      if (at !== null && typeof at !== "string") return at;
      const occupant = { name: name.trim(), room: at, needs: [...new Set(needs)], updatedAt: Date.now() };
      await saveOccupant(occupant);
      const where = at ? `, usually in the ${placeName(at)}` : "";
      return answer(`Saved: ${occupant.name}${where}, ${needsSaid(occupant.needs)}. Every route for ${occupant.name} will fit that.`, { occupant });
    },
  );

  server.registerTool(
    "forget_occupant",
    {
      title: "Forget someone's evacuation needs",
      description: "Delete everything saved about a person by register_occupant.",
      inputSchema: { name: z.string().min(1).max(40) },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ name }) => {
      const known = await findOccupant(name);
      if (!known) return answer(`Nothing was saved about ${name}.`, { forgotten: false });
      await forgetOccupant(name);
      return answer(`Done: everything saved about ${known.name} is deleted.`, { forgotten: true });
    },
  );

  server.registerTool(
    "smoke_forecast",
    {
      title: "Forecast the smoke",
      description: "How smoky every room is a given time after a fire starts in one room, from the drill simulator's smoke model.",
      inputSchema: { fire_room: fireArgs.fire_room.unwrap(), seconds_since_fire: fireArgs.seconds_since_fire },
      annotations: READ_ONLY,
    },
    async ({ fire_room, seconds_since_fire }) => {
      const fire = fireFrom(fire_room, seconds_since_fire) as Fire | CallToolResult;
      if ("content" in fire) return fire;
      const rooms = smokeForecast(fire);
      const bad = rooms.filter((r) => r.smoke >= 0.3 && r.condition !== "on fire").map((r) => r.room);
      const speech =
        `${fire.seconds} seconds after a fire starts in the ${placeName(fire.room)}, ` +
        (bad.length ? `thick smoke has reached the ${bad.join(", the ")}.` : "the smoke has not yet thickened anywhere else.");
      return answer(speech, { fire_room: placeName(fire.room), seconds_since_fire: fire.seconds, rooms });
    },
  );

  server.registerTool(
    "plan_evacuation",
    {
      title: "Plan the whole evacuation",
      description:
        "A warden's plan for the whole building: which exit each occupied room should use, spread over the safe exits, who must shelter in place, and a public-address announcement to read out.",
      inputSchema: {
        ...fireArgs,
        occupancy: z
          .array(z.object({ room: z.string(), people: z.number().int().min(0).max(500) }))
          .max(40)
          .optional()
          .describe("Head count per room. Leave out to plan for one group in every room."),
      },
      annotations: READ_ONLY,
    },
    async ({ fire_room, seconds_since_fire, occupancy }) => {
      const fire = fireFrom(fire_room, seconds_since_fire);
      if (fire && "content" in fire) return fire;
      let counts = everyRoom();
      if (occupancy?.length) {
        counts = new Map();
        for (const entry of occupancy) {
          const found = room(entry.room);
          if (typeof found !== "string") return found;
          counts.set(found, (counts.get(found) ?? 0) + entry.people);
        }
      }
      const result = planEvacuation(fire, counts);
      // everyone with a plan on file gets their own route, fitted to them, after the announcement
      const personal = (await allOccupants())
        .filter((o) => o.room)
        .map((o) => {
          const fitted = personalise(adviseRoute(o.room!, { fire, stepFree: stepFreeFor(o) }), o);
          return { name: o.name, room: placeName(o.room!), needs: o.needs, directions: fitted.speech, show_on_screen: fitted.show_on_screen };
        });
      const speech = personal.length
        ? `${result.broadcast} Personal plans: ${personal.map((p) => `${p.name} in the ${p.room}: ${p.directions}`).join(" ")}`
        : result.broadcast;
      return answer(speech, { ...result, personal_plans: personal });
    },
  );

  server.registerTool(
    "list_safety_fixes",
    {
      title: "List safety fixes",
      description: "Changes the building can make to its evacuation plan (ramps, strobes, text alerts...), who each protects and why. Each is modelled in the drill simulator.",
      annotations: READ_ONLY,
    },
    async () => {
      const fixes = safetyFixes();
      return answer(`There are ${fixes.length} fixes: ${fixes.map((f) => `${f.title}, for ${f.protects}`).join("; ")}.`, { fixes });
    },
  );

  server.registerTool(
    "get_warden_playbook",
    {
      title: "Get the warden's playbook",
      description: "The standing orders the AI fire warden has learned from its training drills, and how the drills have gone.",
      annotations: { ...READ_ONLY, idempotentHint: false },
    },
    async () => {
      try {
        const { playbook, history } = await readShared();
        const rules = playbook?.rules.map((rule) => rule.text) ?? [];
        const last = history.at(-1);
        const speech = rules.length
          ? `The warden follows ${rules.length} standing orders: ${rules.map((r, i) => `${i + 1}. ${r}`).join(" ")}` +
            (last ? ` In the latest of ${history.length} drills, ${Math.round(last.survival * 100)} percent got out.` : "")
          : "The warden has not been trained yet, so it has no standing orders.";
        return answer(speech, {
          version: playbook?.version ?? 0,
          rules,
          last_change: playbook?.lastChange ?? null,
          drills: history.length,
          latest: last ? { drill: last.drill, scenario: last.scenario, survival: last.survival, score: last.score } : null,
        });
      } catch {
        return refuse("The warden's playbook could not be read just now.");
      }
    },
  );

  registerDrillTools(server);
  return server;
}
