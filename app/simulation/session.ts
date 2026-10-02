"use client";

import { create } from "zustand";
import type { CommandCode } from "./commands";
import { createNet } from "./net";
import { setProgressPublisher } from "./store";
import { resolveRoom } from "./net/roles";
import {
  newId,
  type CommandAcknowledgement,
  type DrillRoom,
  type EvacueeState,
  type JoinFailure,
  type NetClient,
  type NetEvent,
  type Participant,
  type RouteMessage,
  type WardenState,
} from "./net/types";

export { resolveRoom } from "./net/roles";

export type SessionStatus = "idle" | "connecting" | "connected" | JoinFailure;

interface SessionState {
  net: NetClient | null;
  status: SessionStatus;
  code: string | null;
  myId: string | null;
  room: DrillRoom | null;
  isHost: boolean;
  startError: string | null;

  connect: (code: string, name: string, asHost?: DrillRoom) => Promise<void>;
  leave: () => void;
  disconnect: () => void;
  startNow: () => Promise<boolean>;
  observeEvidence: (evidenceId: string) => void;
  sendCommand: (command: CommandCode, evidenceId?: string) => void;
  publish: (state: EvacueeState) => void;
  onWardenState: (callback: (state: WardenState) => void) => () => void;
  onRouteMessage: (callback: (message: RouteMessage) => void) => () => void;
  onAcknowledgement: (callback: (acknowledgement: CommandAcknowledgement) => void) => () => void;
}

const wardenStateSubs = new Set<(state: WardenState) => void>();
const routeMessageSubs = new Set<(message: RouteMessage) => void>();
const acknowledgementSubs = new Set<(acknowledgement: CommandAcknowledgement) => void>();
let unsubscribe: (() => void) | null = null;
let unloadListener: (() => void) | null = null;

const subscribe =
  <T>(subscribers: Set<(value: T) => void>) =>
  (callback: (value: T) => void) => {
    subscribers.add(callback);
    return () => {
      subscribers.delete(callback);
    };
  };

/** One participant id per room per tab, so a refresh keeps the seat. */
function playerIdForRoom(code: string) {
  const key = `campusevac:participant:${code}`;
  try {
    const stored = sessionStorage.getItem(key);
    if (stored) return stored;
    const id = newId();
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return newId();
  }
}

export const useSession = create<SessionState>()((set, get) => {
  const myRole = () => {
    const { room, myId } = get();
    return resolveRoom(room)?.participants.find((item) => item.id === myId)?.role ?? null;
  };

  return {
    net: null,
    status: "idle",
    code: null,
    myId: null,
    room: null,
    isHost: false,
    startError: null,

    connect: async (code, name, seedRoom) => {
      get().leave();
      const net = createNet();
      const myId = playerIdForRoom(code);
      const participant: Participant = {
        id: myId,
        name: name.trim() || "participant",
        role: null,
        sectorId: null,
        joinedAt: Date.now(),
        connected: true,
      };

      set({ net, myId, code, status: "connecting", startError: null });

      // only a joined room records progress; solo practice leaves this unset and publishes nothing
      setProgressPublisher((step, elapsed) => net.publishProgress(step, elapsed));

      // A closed tab is otherwise only noticed after the presence timeout. This is best
      // effort — the browser may kill the socket first — so it shortens the common case
      // rather than replacing the timeout.
      const announceLeaving = () => net.leave(code, myId);
      window.addEventListener("pagehide", announceLeaving);
      window.addEventListener("beforeunload", announceLeaving);
      unloadListener = () => {
        window.removeEventListener("pagehide", announceLeaving);
        window.removeEventListener("beforeunload", announceLeaving);
      };

      unsubscribe = net.onMessage((event: NetEvent) => {
        switch (event.type) {
          case "room":
            if (event.room.code !== get().code) return;
            set({ room: event.room, status: "connected", isHost: event.room.hostId === get().myId });
            break;
          case "warden-state":
            for (const callback of wardenStateSubs) callback(event.state);
            break;
          case "route-message":
            for (const callback of routeMessageSubs) callback(event.message);
            break;
          case "command-ack":
            for (const callback of acknowledgementSubs) callback(event.acknowledgement);
            break;
        }
      });

      const fail = (status: SessionStatus) => {
        net.disconnect();
        unsubscribe?.();
        unsubscribe = null;
        set({ status, net: null });
      };

      try {
        await net.connect(code);
        if (seedRoom) await net.createRoom({ ...seedRoom, drillId: seedRoom.drillId || `drill_${code}`, hostId: "" });
      } catch (error) {
        const message = error instanceof Error ? error.message.toLowerCase() : "";
        return fail(message.includes("timed out") ? "timeout" : "connection");
      }

      const result = await net.join(code, participant);
      if ("error" in result) return fail(result.error);
      set({ room: result.room, status: "connected", isHost: result.room.hostId === myId });
    },

    startNow: async () => {
      const { code, myId, net, room, isHost } = get();
      if (
        !code ||
        !myId ||
        !net ||
        !room ||
        !isHost ||
        (room.phase !== "lobby" && room.phase !== "preparing") ||
        room.participants.length < room.maxPlayers
      )
        return false;

      set({ startError: null });
      const result = await net.start(code, myId);
      if (!result.ok) {
        set({ startError: result.error });
        return false;
      }
      return true;
    },

    leave: () => {
      const { net, myId, code } = get();
      if (net && myId && code) net.leave(code, myId);
      get().disconnect();
    },

    disconnect: () => {
      setProgressPublisher(null);
      unloadListener?.();
      unloadListener = null;
      unsubscribe?.();
      unsubscribe = null;
      get().net?.disconnect();
      wardenStateSubs.clear();
      routeMessageSubs.clear();
      acknowledgementSubs.clear();
      set({ net: null, status: "idle", code: null, myId: null, room: null, isHost: false, startError: null });
    },

    observeEvidence: (evidenceId) => {
      if (myRole() !== "warden") return;
      get().net?.send({ type: "observe-evidence", evidenceId, clientSentAt: Date.now() });
    },

    sendCommand: (command, evidenceId) => {
      const { net, room } = get();
      if (!net || resolveRoom(room)?.phase !== "active" || myRole() !== "warden") return;
      net.send({
        type: "warden-command",
        command,
        evidenceId,
        clientSentAt: Date.now(),
        idempotencyKey: newId(),
      });
    },

    publish: (state) => get().net?.send({ type: "evacuee-state", state }),

    onWardenState: subscribe(wardenStateSubs),
    onRouteMessage: subscribe(routeMessageSubs),
    onAcknowledgement: subscribe(acknowledgementSubs),
  };
});
