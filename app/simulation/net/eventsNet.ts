"use client";

import { MARKERS, type MarkerDef, type RoomId, type ScenarioObjectId } from "../level";
import { getSectorSmoke, VENTILATION_SMOKE_FACTOR } from "../smoke";
import { useSimulation } from "../store";
import { EventsSocket } from "./events";
import { assignRoles, resolveRoom } from "./roles";
import {
  COUNTDOWN_MS,
  PRESENCE_PING_MS,
  PRESENCE_TIMEOUT_MS,
  RECONNECT_GRACE_MS,
  WARDEN_SECTORS,
  type ClientIntent,
  type CommandAcknowledgement,
  type DrillRoom,
  type EvacueeState,
  type EvidenceRecord,
  type JoinFailure,
  type JoinResult,
  type NetClient,
  type NetEvent,
  type Participant,
  type RouteMessage,
  type StartResult,
  type WardenState,
} from "./types";

const CONNECT_TIMEOUT_MS = 8_000;
const PROBE_MS = 1_200;
const JOIN_TIMEOUT_MS = 6_000;
const SYNC_RETRY_MS = 1_500;
const PRESENCE_SWEEP_MS = 1_000;

type WardenIntent = Exclude<ClientIntent, { type: "evacuee-state" }>;
type WardenCommand = Extract<ClientIntent, { type: "warden-command" }>;

/** /game/{code}/room and /game/{code}/cmd. The namespace handler stores each one in DynamoDB. */
type GameMessage =
  | { t: "sync"; from: string; participant?: Participant }
  | { t: "room"; from: string; room: DrillRoom }
  | { t: "reject"; from: string; to: string; reason: JoinFailure }
  | { t: "leave"; from: string }
  /** Written to DynamoDB for the debrief and the end-of-drill check. Drives no UI. */
  | { t: "progress"; from: string; step: ScenarioObjectId; at: number; elapsed: number }
  | { t: "intent"; from: string; intent: WardenIntent }
  | { t: "ack"; from: string; to: string; acknowledgement: CommandAcknowledgement };

/** /live/{code}/warden: role-scoped snapshots, broadcast only. */
type LiveMessage = { to: string; state: WardenState };

/** /live/{code}/presence: "still here". Broadcast only, deliberately never stored. */
type PresenceMessage = { from: string; at: number };

/** Drill state held by the evacuee browser once the drill is active. */
interface DrillAuthority {
  drillId: string;
  evacueeState: EvacueeState | null;
  evidence: EvidenceRecord[];
  routeStatus: EvacueeState["routeStatus"];
  interventionApplied: boolean;
  latestMessage: RouteMessage | null;
  lastAcknowledgement: CommandAcknowledgement | null;
  processed: Record<string, CommandAcknowledgement>;
  stateVersion: number;
  eventSequence: number;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

const sectorOf = (participant: Participant): RoomId => participant.sectorId ?? WARDEN_SECTORS[0];

function evidenceFor(marker: MarkerDef, now: number): EvidenceRecord {
  return {
    id: marker.id,
    sectorId: marker.room,
    label: marker.label,
    source: marker.source ?? "Authored sector evidence",
    status: "UNKNOWN",
    observedAt: null,
    verifiedAt: null,
    updatedAt: now,
    nextAction: marker.nextAction ?? "Inspect the evidence before communicating.",
  };
}

function wardenState(room: DrillRoom, drill: DrillAuthority, warden: Participant): WardenState {
  const assignedSector = sectorOf(warden);
  const state = drill.evacueeState;
  return {
    kind: "warden",
    t: Date.now(),
    hazardElapsed: state?.hazardElapsed ?? 0,
    stateVersion: drill.stateVersion,
    eventSequence: drill.eventSequence,
    assignedSector,
    // Movement is shared with the warden in real time; evidence stays sector-scoped.
    evacuee: state ? { position: state.position, sectorId: state.sectorId } : null,
    air: state?.air ?? 100,
    health: state?.health ?? 72,
    hasBackpack: state?.hasBackpack ?? false,
    equipped: state?.equipped ?? null,
    scenarioProgress: state?.scenarioProgress ?? {
      "emergency-backpack": false,
      "lab-access-card": false,
      "gas-valve": false,
      "first-aid-kit": false,
      "lab-safety-clue": false,
      "academic-guide": false,
      "main-exit": false,
    },
    smokeIntensity:
      getSectorSmoke(assignedSector, state?.hazardElapsed ?? 0) *
      (drill.interventionApplied ? VENTILATION_SMOKE_FACTOR : 1),
    routeStatus: drill.routeStatus,
    interventionApplied: drill.interventionApplied,
    assemblyProgress: state?.assemblyProgress ?? (room.outcome === "assembly-confirmed" ? 1 : 0),
    assemblyConfirmed: state?.assemblyConfirmed ?? room.outcome === "assembly-confirmed",
    failed:
      state?.failed ??
      (room.phase === "failed" || room.outcome === "drill-failed" || room.outcome === "participant-left"),
    evidence: drill.evidence.filter((item) => item.sectorId === assignedSector),
    latestMessage: drill.latestMessage,
    lastAcknowledgement: drill.lastAcknowledgement,
    log: state?.log ?? [],
  };
}

/**
 * Two-seat drill over AWS AppSync Events, with no game server:
 * - the host browser owns the lobby (admission, countdown, role draw);
 * - once active, the evacuee browser owns the drill. It already runs movement and smoke, so it
 *   validates warden intents and streams role-scoped warden snapshots at the publish rate.
 * Room snapshots carry a `rev`; every client keeps the highest one it has seen.
 */
export class EventsNet implements NetClient {
  private socket: EventsSocket | null = null;
  private readonly listeners = new Set<(event: NetEvent) => void>();
  private readonly waiters = new Set<(message: GameMessage) => void>();
  private unsubscribe: (() => void)[] = [];
  private activationTimer: ReturnType<typeof setTimeout> | null = null;
  private code = "";
  private myId = "";
  private room: DrillRoom | null = null;
  private lobbyOwner = false;
  private authority: DrillAuthority | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  /** Last presence ping per participant id. */
  private readonly lastSeen = new Map<string, number>();

  async connect(code: string) {
    this.code = code;
    const socket = new EventsSocket();
    this.socket = socket;
    const game = socket.subscribe(`/game/${code}/*`, (payload) => this.receive(payload as GameMessage));
    const live = socket.subscribe(`/live/${code}/warden`, (payload) => this.receiveLive(payload as LiveMessage));
    const presence = socket.subscribe(`/live/${code}/presence`, (payload) =>
      this.receivePresence(payload as PresenceMessage),
    );
    this.unsubscribe = [game.close, live.close, presence.close];
    await withTimeout(
      Promise.all([game.ready, live.ready, presence.ready]),
      CONNECT_TIMEOUT_MS,
      "realtime connection timed out",
    );
    this.startPresence();
  }

  disconnect() {
    if (this.activationTimer) clearTimeout(this.activationTimer);
    this.activationTimer = null;
    this.stopPresence();
    this.lastSeen.clear();
    for (const stop of this.unsubscribe) stop();
    this.unsubscribe = [];
    this.socket?.close();
    this.socket = null;
    this.listeners.clear();
    this.waiters.clear();
    this.room = null;
    this.authority = null;
    this.lobbyOwner = false;
    this.code = "";
    this.myId = "";
  }

  async createRoom(seed: DrillRoom) {
    // A refreshed host finds the drill still held by the other browser.
    const existing = await this.waitFor(
      (message) => (message.t === "room" ? message.room : undefined),
      PROBE_MS,
      () => this.publish({ t: "sync", from: this.myId }),
    );
    if (existing) return existing;
    this.lobbyOwner = true;
    this.room = { ...seed, drillId: seed.drillId || `drill_${seed.code}`, rev: 1 };
    this.emit({ type: "room", room: this.room });
    return this.room;
  }

  async join(code: string, participant: Participant): Promise<JoinResult> {
    this.myId = participant.id;
    if (this.lobbyOwner && this.room) {
      const failure = this.admit(participant);
      return failure ? { error: failure } : { room: this.room };
    }

    let sawRoom = false;
    const outcome = await this.waitFor<DrillRoom | JoinFailure>(
      (message) => {
        if (message.t === "reject" && message.to === participant.id) return message.reason;
        if (message.t !== "room") return undefined;
        sawRoom = true;
        return message.room.participants.some((item) => item.id === participant.id) ? message.room : undefined;
      },
      JOIN_TIMEOUT_MS,
      () => this.publish({ t: "sync", from: participant.id, participant }),
    );
    if (!outcome) return { error: sawRoom ? "unavailable" : "notfound" };
    if (typeof outcome === "string") return { error: outcome };
    return { room: this.room ?? outcome };
  }

  leave(_code: string, playerId: string) {
    this.publish({ t: "leave", from: playerId });
  }

  async start(_code: string, playerId: string): Promise<StartResult> {
    const room = resolveRoom(this.room);
    if (!room) return { ok: false, error: "notfound" };
    if (!this.lobbyOwner || room.hostId !== playerId) return { ok: false, error: "not-host" };
    if (room.participants.length < room.maxPlayers) return { ok: false, error: "not-ready" };
    if (room.phase !== "lobby" && room.phase !== "preparing") return { ok: false, error: "started" };
    this.commitRoom({
      ...room,
      phase: "active",
      startsAt: null,
      participants: assignRoles(room.participants, room.seed),
    });
    return { ok: true };
  }

  send(intent: ClientIntent) {
    const role = this.me()?.role;
    if (intent.type === "evacuee-state") {
      if (role === "evacuee") this.publishEvacuee(intent.state);
      return;
    }
    if (role === "warden") this.publish({ t: "intent", from: this.myId, intent });
  }

  publishProgress(step: ScenarioObjectId, elapsed: number) {
    if (!this.code || !this.myId) return;
    this.publish({ t: "progress", from: this.myId, step, at: Date.now(), elapsed });
  }

  onMessage(callback: (event: NetEvent) => void) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /* ------------------------------------------------------------- transport */

  private publish(message: GameMessage) {
    const channel = message.t === "intent" || message.t === "ack" ? "cmd" : "room";
    this.socket?.publish(`/game/${this.code}/${channel}`, [message]);
  }

  private receive(message: GameMessage) {
    if (!message || typeof message !== "object" || message.from === this.myId) return;
    switch (message.t) {
      case "room":
        this.adopt(message.room);
        break;
      case "sync":
        if (!this.room) break;
        if (this.lobbyOwner && message.participant) {
          const failure = this.admit(message.participant);
          if (failure)
            this.publish({ t: "reject", from: this.myId, to: message.participant.id, reason: failure });
        } else {
          this.publish({ t: "room", from: this.myId, room: this.room });
        }
        break;
      case "leave":
        this.removeParticipant(message.from);
        break;
      case "progress":
        // recorded by the namespace handler on the way through; nothing to apply locally
        break;
      case "intent":
        this.authorize(message.from, message.intent);
        break;
      case "ack":
        if (message.to === this.myId)
          this.emit({ type: "command-ack", acknowledgement: message.acknowledgement });
        break;
    }
    for (const waiter of [...this.waiters]) waiter(message);
  }

  private receiveLive(message: LiveMessage) {
    if (message?.to === this.myId) this.emit({ type: "warden-state", state: message.state });
  }

  /* --------------------------------------------------------------- presence */

  private startPresence() {
    this.stopPresence();
    const ping = () => {
      if (!this.code || !this.myId) return;
      // volatile: a ping that could not go out is worthless a moment later
      this.socket?.publish(`/live/${this.code}/presence`, [{ from: this.myId, at: Date.now() }], true);
    };
    ping();
    this.pingTimer = setInterval(ping, PRESENCE_PING_MS);
    this.sweepTimer = setInterval(() => this.sweepPresence(), PRESENCE_SWEEP_MS);
  }

  private stopPresence() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.pingTimer = null;
    this.sweepTimer = null;
    this.graceTimer = null;
  }

  private receivePresence(message: PresenceMessage) {
    if (!message || typeof message.from !== "string" || message.from === this.myId) return;
    this.lastSeen.set(message.from, Date.now());
    // a ping is proof of life, so a brief network drop recovers without a rejoin
    const room = resolveRoom(this.room);
    if (room?.participants.some((item) => item.id === message.from && item.connected === false)) {
      this.setConnected(message.from, true);
    }
  }

  /**
   * Marks anyone who has gone quiet. This is what catches a closed tab, since a closed tab
   * sends no `leave`. Participants are only judged once they have pinged at least once, so a
   * client that is still finishing its own connect is never mistaken for a dropout.
   */
  private sweepPresence() {
    const room = resolveRoom(this.room);
    if (!room || room.phase !== "active") return;
    const now = Date.now();
    for (const participant of room.participants) {
      if (participant.id === this.myId) continue;
      const seen = this.lastSeen.get(participant.id);
      if (seen === undefined) continue;
      if (now - seen > PRESENCE_TIMEOUT_MS && participant.connected !== false) {
        this.setConnected(participant.id, false);
      }
    }
  }

  /**
   * Flips a participant's presence and runs the grace period around it.
   *
   * Known limitation: the evacuee browser owns the drill state in memory, so if the
   * evacuee's tab is actually closed that state is gone and rejoining restarts the run. The
   * grace period covers a browser that is still open — a refresh, a brief network drop — and
   * the warden reconnecting. Surviving a closed evacuee tab would need the drill state
   * persisted somewhere outside it, which is out of scope here.
   */
  private setConnected(id: string, connected: boolean) {
    const room = resolveRoom(this.room);
    if (!room || !room.participants.some((item) => item.id === id)) return;
    const participants = room.participants.map((item) => (item.id === id ? { ...item, connected } : item));
    this.applyRoom({ ...room, participants });

    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = null;
    if (connected) return;

    this.graceTimer = setTimeout(() => {
      this.graceTimer = null;
      const current = resolveRoom(this.room);
      const stillGone = current?.participants.find((item) => item.id === id)?.connected === false;
      if (!current || current.phase !== "active" || !stillGone) return;
      this.applyRoom({ ...current, phase: "failed", outcome: "participant-left" });
    }, RECONNECT_GRACE_MS);
  }

  /** Commit when this browser owns the lobby, otherwise apply locally so the UI still reacts. */
  private applyRoom(next: DrillRoom) {
    if (this.lobbyOwner) {
      this.commitRoom(next);
      return;
    }
    this.room = next;
    this.emit({ type: "room", room: next });
  }

  /** Resolve with the first message `match` accepts, re-sending `kick` until then; null on timeout. */
  private waitFor<T>(match: (message: GameMessage) => T | undefined, ms: number, kick: () => void) {
    return new Promise<T | null>((resolve) => {
      const finish = (value: T | null) => {
        clearTimeout(timer);
        clearInterval(retry);
        this.waiters.delete(waiter);
        resolve(value);
      };
      const waiter = (message: GameMessage) => {
        const value = match(message);
        if (value !== undefined) finish(value);
      };
      const timer = setTimeout(() => finish(null), ms);
      const retry = setInterval(kick, SYNC_RETRY_MS);
      this.waiters.add(waiter);
      kick();
    });
  }

  private emit(event: NetEvent) {
    for (const callback of this.listeners) callback(event);
  }

  /* ------------------------------------------------------------------ lobby */

  private me() {
    return resolveRoom(this.room)?.participants.find((item) => item.id === this.myId) ?? null;
  }

  private adopt(room: DrillRoom) {
    if (room.code !== this.code) return;
    if (this.room && (room.rev ?? 0) < (this.room.rev ?? 0)) return;
    this.room = room;
    if (this.myId && room.hostId === this.myId) this.lobbyOwner = true;
    this.scheduleActivation();
    this.emit({ type: "room", room });
  }

  private commitRoom(next: DrillRoom) {
    this.room = { ...next, rev: Math.max(next.rev ?? 0, this.room?.rev ?? 0) + 1 };
    this.scheduleActivation();
    this.emit({ type: "room", room: this.room });
    this.publish({ t: "room", from: this.myId, room: this.room });
  }

  private admit(participant: Participant): JoinFailure | null {
    const room = resolveRoom(this.room);
    if (!room) return "notfound";
    const existing = room.participants.some((item) => item.id === participant.id);
    if (!existing && room.phase !== "lobby" && room.phase !== "preparing") return "unavailable";
    if (!existing && room.participants.length >= room.maxPlayers) return "full";
    if (existing) {
      // a returning browser cancels the countdown immediately rather than waiting for its
      // first presence ping to land
      if (this.graceTimer) clearTimeout(this.graceTimer);
      this.graceTimer = null;
      this.lastSeen.set(participant.id, Date.now());
    }
    const participants = existing
      ? room.participants.map((item) =>
          item.id === participant.id ? { ...item, name: participant.name, connected: true } : item,
        )
      : [...room.participants, { ...participant, role: null, sectorId: null, connected: true }];
    const full = participants.length >= room.maxPlayers && room.phase === "lobby";
    this.commitRoom({
      ...room,
      hostId: room.hostId || participant.id,
      participants,
      ...(full ? { phase: "preparing" as const, startsAt: Date.now() + COUNTDOWN_MS } : {}),
    });
    return null;
  }

  private removeParticipant(id: string) {
    const room = resolveRoom(this.room);
    if (!room || !room.participants.some((item) => item.id === id)) return;
    // Mid-drill a `leave` is the fast path into the grace period rather than an instant
    // failure: the seat is held open so a refreshed browser can take it back.
    if (room.phase === "active") {
      this.lastSeen.delete(id);
      this.setConnected(id, false);
      return;
    }
    const participants = room.participants.filter((item) => item.id !== id);
    const next: DrillRoom =
      room.phase === "preparing"
        ? { ...room, participants, phase: "lobby", startsAt: null }
        : { ...room, participants };
    this.applyRoom(next);
  }

  private scheduleActivation() {
    if (this.activationTimer) clearTimeout(this.activationTimer);
    this.activationTimer = null;
    const room = this.room;
    if (!this.lobbyOwner || room?.phase !== "preparing" || room.startsAt === null) return;
    this.activationTimer = setTimeout(
      () => {
        this.activationTimer = null;
        const active = resolveRoom(this.room);
        if (active?.phase === "active" && this.room?.phase === "preparing") this.commitRoom(active);
      },
      Math.max(0, room.startsAt - Date.now()) + 50,
    );
  }

  /* ------------------------------------------------------ evacuee authority */

  private drill(room: DrillRoom): DrillAuthority {
    if (this.authority?.drillId === room.drillId) return this.authority;
    const now = Date.now();
    this.authority = {
      drillId: room.drillId,
      evacueeState: null,
      evidence: MARKERS.filter((marker) => marker.kind === "evidence").map((marker) => evidenceFor(marker, now)),
      routeStatus: "clear",
      interventionApplied: false,
      latestMessage: null,
      lastAcknowledgement: null,
      processed: {},
      stateVersion: 0,
      eventSequence: 0,
    };
    return this.authority;
  }

  private broadcastWarden(room: DrillRoom, drill: DrillAuthority, volatile: boolean) {
    for (const warden of room.participants) {
      if (warden.role !== "warden") continue;
      const message: LiveMessage = { to: warden.id, state: wardenState(room, drill, warden) };
      this.socket?.publish(`/live/${this.code}/warden`, [message], volatile);
    }
  }

  private publishEvacuee(state: EvacueeState) {
    const room = resolveRoom(this.room);
    if (!room) return;
    const drill = this.drill(room);
    const routeStatus = drill.interventionApplied
      ? "intervened"
      : drill.routeStatus === "unsafe"
        ? "unsafe"
        : state.routeStatus;
    drill.evacueeState = {
      ...state,
      routeStatus,
      interventionApplied: state.interventionApplied || drill.interventionApplied,
    };
    drill.routeStatus = routeStatus;
    drill.stateVersion += 1;

    if (room.phase === "active" && state.assemblyConfirmed)
      this.commitRoom({ ...room, phase: "assembly", outcome: "assembly-confirmed" });
    else if (room.phase === "active" && state.failed)
      this.commitRoom({ ...room, phase: "failed", outcome: "drill-failed" });

    this.broadcastWarden(room, drill, true);
  }

  private authorize(from: string, intent: WardenIntent) {
    const room = resolveRoom(this.room);
    const warden = room?.participants.find((item) => item.id === from);
    if (!room || this.me()?.role !== "evacuee" || warden?.role !== "warden") return;
    const drill = this.drill(room);

    if (intent.type === "observe-evidence") {
      const evidence = drill.evidence.find((item) => item.id === intent.evidenceId);
      if (!evidence || evidence.sectorId !== sectorOf(warden) || evidence.status !== "UNKNOWN") return;
      const now = Date.now();
      evidence.status = "OBSERVED";
      evidence.observedAt ??= now;
      evidence.updatedAt = now;
      drill.eventSequence += 1;
      drill.stateVersion += 1;
      this.broadcastWarden(room, drill, false);
      return;
    }

    let acknowledgement = drill.processed[intent.idempotencyKey];
    if (!acknowledgement) {
      acknowledgement = this.applyCommand(room, drill, warden, intent);
      drill.processed[intent.idempotencyKey] = acknowledgement;
      drill.lastAcknowledgement = acknowledgement;
      drill.stateVersion += 1;
    }
    this.publish({ t: "ack", from: this.myId, to: from, acknowledgement });
    this.broadcastWarden(room, drill, false);
  }

  private applyCommand(
    room: DrillRoom,
    drill: DrillAuthority,
    warden: Participant,
    command: WardenCommand,
  ): CommandAcknowledgement {
    const now = Date.now();
    const evidence = drill.evidence.find((item) => item.id === (command.evidenceId ?? "east-route-evidence"));
    const ack = (accepted: boolean, reason: string | null): CommandAcknowledgement => ({
      id: `${drill.drillId}:ack:${command.idempotencyKey}`,
      command: command.command,
      accepted,
      reason,
      at: now,
      stateVersion: drill.stateVersion,
      eventSequence: drill.eventSequence,
    });
    const deny = (reason: string) => ack(false, reason);

    if (room.phase !== "active") return deny("drill is not active");
    if (!evidence) return deny("evidence target is unavailable");
    if (evidence.sectorId !== sectorOf(warden)) return deny("not your sector");

    switch (command.command) {
      case "VERIFY_EAST_ROUTE":
        if (evidence.status !== "OBSERVED") return deny("observe the evidence first");
        evidence.status = "VERIFIED";
        evidence.verifiedAt = now;
        evidence.updatedAt = now;
        break;
      case "SEND_WEST_ROUTE":
      case "MARK_EAST_UNSAFE":
        if (evidence.status !== "VERIFIED") return deny("verify the east route first");
        drill.routeStatus = drill.interventionApplied ? "intervened" : "unsafe";
        if (command.command === "SEND_WEST_ROUTE") {
          drill.latestMessage = {
            messageId: `${drill.drillId}:message:${drill.eventSequence + 1}`,
            drillId: drill.drillId,
            senderId: warden.id,
            senderSector: sectorOf(warden),
            targetSector: "lobby",
            direction: "west",
            kind: "route",
            confidence: "verified",
            urgency: "urgent",
            createdAt: now,
            expiresAt: now + 12_000,
            caption: "East route is unsafe. Proceed to the verified west route.",
            acknowledgedAt: null,
          };
          this.emit({ type: "route-message", message: drill.latestMessage });
        }
        break;
      case "APPLY_VENTILATION":
        if (drill.interventionApplied) return deny("intervention already applied");
        if (evidence.status !== "VERIFIED") return deny("verify the route evidence first");
        drill.interventionApplied = true;
        drill.routeStatus = "intervened";
        // This browser runs the evacuee simulation, which reads the flag for smoke density.
        useSimulation.getState().applyIntervention();
        break;
    }
    drill.eventSequence += 1;
    return ack(true, null);
  }
}
