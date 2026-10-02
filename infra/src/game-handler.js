import * as ddb from "@aws-appsync/utils/dynamodb";

// Keep in sync with EVENTS_TABLE in lib/campusevac-stack.ts.
const TABLE = "campusevac-events";
const WEEK_SECONDS = 7 * 24 * 60 * 60;
const CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const CHANNELS = ["room", "cmd"];
const MESSAGE_TYPES = ["sync", "room", "reject", "leave", "progress", "intent", "ack"];
const MAX_EVENT_CHARS = 8000;

// APPSYNC_JS has no regex support, so room codes are checked character by character.
function validCode(code) {
  return (
    typeof code === "string" &&
    code.length >= 4 &&
    code.length <= 8 &&
    code.split("").every((char) => CODE_ALPHABET.indexOf(char) >= 0)
  );
}

/** Only well-formed drill messages are stored and broadcast; anything else is dropped. */
function validEvent(event) {
  const payload = event.payload;
  return (
    payload !== null &&
    typeof payload === "object" &&
    MESSAGE_TYPES.indexOf(payload.t) >= 0 &&
    typeof payload.from === "string" &&
    JSON.stringify(payload).length <= MAX_EVENT_CHARS
  );
}

/** /game/{code}/{room|cmd}: persist, then broadcast. */
export const onPublish = {
  request(ctx) {
    const segments = ctx.info.channel.segments;
    const code = segments[1];
    const channel = segments[2];
    if (!validCode(code) || CHANNELS.indexOf(channel) < 0) util.unauthorized();

    const events = ctx.events.filter((event) => validEvent(event));
    if (events.length === 0) return runtime.earlyReturn([]);

    const now = util.time.nowEpochMilliSeconds();
    return ddb.batchPut({
      tables: {
        [TABLE]: events.map((event) => ({
          pk: `DRILL#${code}`,
          sk: `${now}#${event.id}`,
          kind: channel,
          at: now,
          ttl: Math.floor(now / 1000) + WEEK_SECONDS,
          payload: event.payload,
        })),
      },
    });
  },
  response(ctx) {
    return ctx.events.filter((event) => validEvent(event));
  },
};
