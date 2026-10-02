/**
 * Every line the narrator can say, with a stable clip id.
 *
 * Imported by two very different callers, so it stays free of browser and React APIs:
 *   - `scripts/synth-voice.ts` reads it under Node to render the MP3s with Polly
 *   - `narration.ts` reads it in the browser to look those MP3s up and play them
 *
 * Editing a line here changes its content hash, so the next `npm run voice` re-renders
 * only that clip. Lines are authored constants on purpose: the whole script is known
 * before a drill starts, which is what lets the audio be built once instead of per run.
 */

import {
  CRITICAL_SCENARIO_OBJECTS,
  newScenarioProgress,
  nextScenarioGuidance,
  type RoomId,
  type ScenarioObjectId,
} from "./level.ts";

export const VOICE_ID = "Matthew";
export const VOICE_ENGINE = "neural";

/** Played back to back with this much silence between them, in seconds. */
export const CLIP_GAP = 0.18;

export type ClipId = string;
/** What to caption and which clips voice it. An empty `ids` means "caption only". */
export type Cue = { ids: ClipId[]; text: string };

/* -- the script --------------------------------------------------------- */

/** One line per briefing artwork slide. */
export const EVACUEE_BRIEFING = [
  "Welcome to CampusEvac. This is a fire drill. You are the evacuee, standing at the main entrance of the Science Block.",
  "You have six steps. Grab the backpack by the entrance. Then, in Chemistry Lab 1A, take the access card, close the gas valve, use the first-aid kit and read the safety note.",
  "Next, read the route guide in Classroom A201. When all six are done, return to the entrance and leave through the green exit doors.",
  "Your steps are listed top left and the map is top right. W A S D to move, E to interact, V to change camera, Escape to pause. Smoke builds over time, so keep moving.",
];

/** Said once, the first time the evacuee walks into a place. */
export const ROOM_NARRATION: Partial<Record<RoomId, string>> = {
  lobby: "Central corridor. The west door leads to Chemistry Lab 1A. The east door leads to Classroom A201.",
  wcorr: "Science Block passage. Chemistry Lab 1A is straight ahead.",
  sec: "Chemistry Lab 1A. The gas shut-off is in the back-left corner. The first-aid table is by the window.",
  ecorr: "Academic Block passage. Classroom A201 is straight ahead.",
  vault: "Classroom A201. The route guide is on the desk nearest the door.",
  annex: "Electrical service room. There is nothing you need in here. Head back out.",
  atrium: "Main Hall. Smoke rises and collects under this high ceiling. Stay low. The library is west, the cafeteria is east.",
  library: "Library. Nothing you need is in here. Smoke is building between the stacks, so head back to the Main Hall.",
  cafe: "Cafeteria. Nothing you need is in here. Head back through the Main Hall to the corridor.",
};

/** Confirmation when a step is completed. */
const DONE: Record<ScenarioObjectId, string> = {
  "emergency-backpack": "Backpack secured.",
  "lab-access-card": "Access card collected.",
  "gas-valve": "Gas valve closed. The leak has stopped.",
  "first-aid-kit": "First-aid kit used. Health restored.",
  "lab-safety-clue": "Safety note read.",
  "academic-guide": "Route guide read.",
  "main-exit": "You made it out. Drill complete.",
};

/**
 * The follow-on instruction, keyed by the objective it points at, taken straight from
 * `nextScenarioGuidance` so the spoken line can never drift from the on-screen one.
 * Objectives can be completed out of order, so every "done" line has to be able to
 * pair with every "next" line — which is why these are separate clips rather than
 * pre-joined sentences.
 */
export const NEXT_INSTRUCTION: Record<ScenarioObjectId, string> = (() => {
  const progress = newScenarioProgress();
  const lines = {} as Record<ScenarioObjectId, string>;
  for (const id of CRITICAL_SCENARIO_OBJECTS) {
    lines[id] = `Next: ${nextScenarioGuidance(progress).instruction}`;
    progress[id] = true;
  }
  // with everything else done the guidance points at the exit, and reads without a "Next:" lead
  lines["main-exit"] = nextScenarioGuidance(progress).instruction;
  return lines;
})();

/* -- clip ids ----------------------------------------------------------- */

export const briefingClip = (index: number): ClipId => `brief-${index + 1}`;
export const roomClip = (room: RoomId): ClipId => `room-${room}`;
export const doneClip = (id: ScenarioObjectId): ClipId => `done-${id}`;
export const nextClip = (id: ScenarioObjectId): ClipId => `next-${id}`;

/** Every clip the build step renders, in a stable order. */
export const CLIPS: ReadonlyArray<{ id: ClipId; text: string }> = [
  ...EVACUEE_BRIEFING.map((text, index) => ({ id: briefingClip(index), text })),
  ...Object.entries(ROOM_NARRATION).map(([room, text]) => ({ id: roomClip(room as RoomId), text: text! })),
  ...Object.entries(DONE).map(([id, text]) => ({ id: doneClip(id as ScenarioObjectId), text })),
  ...Object.entries(NEXT_INSTRUCTION).map(([id, text]) => ({ id: nextClip(id as ScenarioObjectId), text })),
];

export const ALL_CLIP_IDS: ClipId[] = CLIPS.map((clip) => clip.id);
export const BRIEFING_CLIP_IDS: ClipId[] = EVACUEE_BRIEFING.map((_, index) => briefingClip(index));

/* -- cues --------------------------------------------------------------- */

/**
 * Bedrock can replace the briefing text at runtime. When it does, the words no longer
 * match anything that was rendered, so the cue carries no clips and the player falls
 * back to a silent, correctly timed caption instead of playing the wrong audio.
 */
export function briefingCue(index: number, line: string): Cue {
  return { ids: EVACUEE_BRIEFING[index] === line ? [briefingClip(index)] : [], text: line };
}

export function roomCue(room: RoomId): Cue | null {
  const text = ROOM_NARRATION[room];
  return text ? { ids: [roomClip(room)], text } : null;
}

/** "Gas valve closed." followed by wherever the evacuee should go next. */
export function objectiveCue(id: ScenarioObjectId, progress: Record<ScenarioObjectId, boolean>): Cue {
  const done = DONE[id];
  if (id === "main-exit") return { ids: [doneClip(id)], text: done };
  const next = nextScenarioGuidance(progress);
  if (next.id === "complete") return { ids: [doneClip(id)], text: done };
  const instruction = NEXT_INSTRUCTION[next.id];
  return { ids: [doneClip(id), nextClip(next.id)], text: `${done} ${instruction}` };
}

/* -- SSML --------------------------------------------------------------- */

/**
 * Polly reads raw text badly in exactly the places that matter here: "1A" becomes
 * "one-ay" and "A201" becomes a number. One transform covers every line, so editing
 * the script never means hand-writing markup.
 */
export function toSsml(text: string): string {
  const spoken = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\bCampusEvac\b/g, "Campus Evac")
    .replace(/\b(?:1A|A201|WASD)\b/g, (token) => `<say-as interpret-as="characters">${token}</say-as>`)
    .replace(/([.:!?]) (?=[A-Z])/g, '$1<break time="260ms"/> ');
  return `<speak><prosody rate="95%">${spoken}</prosody></speak>`;
}
