import type { EquipmentId, RoomId, ScenarioObjectId, ScenarioProgress } from "../level";
import type { CommandCode } from "../commands";

export type Role = "evacuee" | "warden";
export type Phase =
  | "lobby"
  | "preparing"
  | "active"
  | "assembly"
  | "failed"
  | "reported";

/** The authored MVP gives the warden the utility/evidence sector feed. */
export const WARDEN_SECTORS: RoomId[] = ["sec"];

export const COUNTDOWN_MS = 10_000;

/* -- presence ------------------------------------------------------------
   A closed tab sends nothing, so absence has to be inferred from silence. Every client
   pings on /live/{code}/presence, which is broadcast only and never written to DynamoDB. */

/** How often each client announces itself. */
export const PRESENCE_PING_MS = 2_000;
/** Silence longer than this counts as gone: two missed pings plus slack. */
export const PRESENCE_TIMEOUT_MS = 5_000;
/** How long a dropped participant has to come back before the drill ends. */
export const RECONNECT_GRACE_MS = 10_000;

export type RoomResult =
  | "assembly-confirmed"
  | "drill-failed"
  | "participant-left";

export interface Participant {
  id: string;
  name: string;
  role: Role | null;
  /** The authored sector feed assigned to a warden. */
  sectorId: RoomId | null;
  joinedAt: number;
  connected?: boolean;
}

export interface DrillRoom {
  drillId: string;
  code: string;
  hostId: string;
  maxPlayers: number;
  phase: Phase;
  /** Epoch milliseconds at which preparation becomes active. */
  startsAt: number | null;
  participants: Participant[];
  createdAt: number;
  scenarioVersion: string;
  seed: number;
  outcome: RoomResult | null;
  /** Monotonic snapshot revision; clients keep the highest one they have seen. */
  rev?: number;
}

export type EvidenceStatus =
  | "UNKNOWN"
  | "OBSERVED"
  | "VERIFIED"
  | "STALE"
  | "EXPIRED";

export interface EvidenceRecord {
  id: string;
  sectorId: RoomId;
  label: string;
  source: string;
  status: EvidenceStatus;
  observedAt: number | null;
  verifiedAt: number | null;
  updatedAt: number;
  nextAction: string;
}

export type RouteDirection = "west" | "east" | "wait" | "assembly";
export type MessageKind = "route" | "hazard" | "wait" | "assembly";

export interface RouteMessage {
  messageId: string;
  drillId: string;
  senderId: string;
  senderSector: RoomId;
  targetSector: RoomId;
  direction: RouteDirection;
  kind: MessageKind;
  confidence: "observed" | "verified";
  urgency: "normal" | "urgent";
  createdAt: number;
  expiresAt: number;
  caption: string;
  acknowledgedAt: number | null;
}

export interface CommandAcknowledgement {
  id: string;
  command: CommandCode;
  accepted: boolean;
  reason: string | null;
  at: number;
  stateVersion: number;
  eventSequence: number;
}

export interface LogEntry {
  id: number;
  text: string;
  tone: "info" | "good" | "bad";
}

/** What the evacuee browser publishes at the render rate. Never sent to the warden as-is. */
export interface EvacueeState {
  kind: "evacuee";
  t: number;
  hazardElapsed: number;
  stateVersion: number;
  eventSequence: number;
  position: [number, number, number, number];
  sectorId: RoomId;
  air: number;
  health: number;
  hasBackpack: boolean;
  equipped: EquipmentId | null;
  scenarioProgress: ScenarioProgress;
  smokeIntensity: number;
  stamina: number;
  routeStatus: "clear" | "unsafe" | "intervened";
  interventionApplied: boolean;
  assemblyProgress: number;
  assemblyConfirmed: boolean;
  failed: boolean;
  routeMessage: RouteMessage | null;
  log: LogEntry[];
}

/** Warden payload. Evidence is filtered to the participant's assigned sector. */
export interface WardenState {
  kind: "warden";
  t: number;
  /** Mirrored from the evacuee so both debriefs report the same drill time. */
  hazardElapsed: number;
  stateVersion: number;
  eventSequence: number;
  assignedSector: RoomId;
  evacuee: {
    position: [number, number, number, number];
    sectorId: RoomId;
  } | null;
  air: number;
  health: number;
  hasBackpack: boolean;
  equipped: EquipmentId | null;
  scenarioProgress: ScenarioProgress;
  smokeIntensity: number;
  routeStatus: "clear" | "unsafe" | "intervened";
  interventionApplied: boolean;
  assemblyProgress: number;
  assemblyConfirmed: boolean;
  failed: boolean;
  evidence: EvidenceRecord[];
  latestMessage: RouteMessage | null;
  lastAcknowledgement: CommandAcknowledgement | null;
  log: LogEntry[];
}

export type ClientIntent =
  | { type: "evacuee-state"; state: EvacueeState }
  | {
      type: "warden-command";
      command: CommandCode;
      evidenceId?: string;
      clientSentAt: number;
      idempotencyKey: string;
    }
  | { type: "observe-evidence"; evidenceId: string; clientSentAt: number };

export type NetEvent =
  | { type: "room"; room: DrillRoom }
  | { type: "warden-state"; state: WardenState }
  | { type: "route-message"; message: RouteMessage }
  | { type: "command-ack"; acknowledgement: CommandAcknowledgement };

export type JoinFailure =
  | "notfound"
  | "full"
  | "unavailable"
  | "timeout"
  | "connection";
export type StartFailure = "notfound" | "not-host" | "not-ready" | "started";
export type StartResult =
  | { ok: true }
  | { ok: false; error: StartFailure };
export type JoinResult =
  | { room: DrillRoom }
  | { error: JoinFailure };

/** The simulation speaks intents and receives role-scoped events; the transport owns the room. */
export interface NetClient {
  connect(code: string): Promise<void>;
  disconnect(): void;
  createRoom(room: DrillRoom): Promise<DrillRoom>;
  join(code: string, participant: Participant): Promise<JoinResult>;
  leave(code: string, playerId: string): void;
  start(code: string, playerId: string): Promise<StartResult>;
  send(intent: ClientIntent): void;
  /** Records a completed objective in the drill history. Fire and forget; drives no UI. */
  publishProgress(step: ScenarioObjectId, elapsed: number): void;
  onMessage(cb: (event: NetEvent) => void): () => void;
}

export const newCode = () => {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 5; i++)
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
};

export const newId = () =>
  `p_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;
