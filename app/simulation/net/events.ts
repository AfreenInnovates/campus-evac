"use client";

/**
 * Minimal AWS AppSync Events WebSocket client using API key auth.
 * Protocol: https://docs.aws.amazon.com/appsync/latest/eventapi/event-api-websocket-protocol.html
 */

const HOST = process.env.NEXT_PUBLIC_EVENTS_HTTP_HOST?.trim() ?? "";
const REALTIME_URL = process.env.NEXT_PUBLIC_EVENTS_REALTIME_URL?.trim() ?? "";
const API_KEY = process.env.NEXT_PUBLIC_EVENTS_API_KEY?.trim() ?? "";

const MAX_EVENTS_PER_PUBLISH = 5;
const MAX_QUEUED = 50;
const MAX_RETRY_MS = 10_000;

type ServerMessage = {
  type: string;
  id?: string;
  event?: unknown;
  errors?: unknown;
  connectionTimeoutMs?: number;
};

type Subscriber = {
  channel: string;
  onEvent: (payload: unknown) => void;
  settle: { resolve: () => void; reject: (error: Error) => void } | null;
};

export interface Subscription {
  /** Resolves on the first `subscribe_success`. */
  ready: Promise<void>;
  close: () => void;
}

const authorization = () => ({ host: HOST, "x-api-key": API_KEY });

const base64Url = (value: unknown) =>
  btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

let counter = 0;
const operationId = () => `${Date.now().toString(36)}-${(++counter).toString(36)}`;

/** One socket per drill. Reconnects with jittered backoff and restores its subscriptions. */
export class EventsSocket {
  private ws: WebSocket | null = null;
  private ready = false;
  private closed = false;
  private attempts = 0;
  private timeoutMs = 300_000;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private readonly subscribers = new Map<string, Subscriber>();
  private readonly queue: string[] = [];

  constructor() {
    if (!HOST || !REALTIME_URL || !API_KEY)
      throw new Error("AppSync Events is not configured: set NEXT_PUBLIC_EVENTS_* in .env.local");
    this.open();
  }

  subscribe(channel: string, onEvent: (payload: unknown) => void): Subscription {
    const id = operationId();
    const ready = new Promise<void>((resolve, reject) => {
      this.subscribers.set(id, { channel, onEvent, settle: { resolve, reject } });
    });
    if (this.ready) this.sendSubscribe(id, channel);
    return {
      ready,
      close: () => {
        if (this.subscribers.delete(id) && this.ready) this.send({ type: "unsubscribe", id });
      },
    };
  }

  /** Volatile events (high-frequency snapshots) are dropped while offline instead of queued. */
  publish(channel: string, events: unknown[], volatile = false) {
    for (let i = 0; i < events.length; i += MAX_EVENTS_PER_PUBLISH) {
      const message = JSON.stringify({
        type: "publish",
        id: operationId(),
        channel,
        events: events.slice(i, i + MAX_EVENTS_PER_PUBLISH).map((event) => JSON.stringify(event)),
        authorization: authorization(),
      });
      if (this.ready) this.ws?.send(message);
      else if (!volatile && this.queue.length < MAX_QUEUED) this.queue.push(message);
    }
  }

  close() {
    this.closed = true;
    this.ready = false;
    this.clearTimers();
    this.subscribers.clear();
    this.queue.length = 0;
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }

  private open() {
    const ws = new WebSocket(REALTIME_URL, ["aws-appsync-event-ws", `header-${base64Url(authorization())}`]);
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: "connection_init" }));
    ws.onmessage = (message) => {
      if (this.ws !== ws) return;
      let parsed: ServerMessage;
      try {
        parsed = JSON.parse(String(message.data)) as ServerMessage;
      } catch {
        return;
      }
      this.receive(parsed);
    };
    ws.onclose = () => {
      if (this.ws === ws) this.reconnect();
    };
    ws.onerror = () => ws.close();
  }

  private receive(message: ServerMessage) {
    this.keepAlive();
    switch (message.type) {
      case "connection_ack":
        this.ready = true;
        this.attempts = 0;
        this.timeoutMs = message.connectionTimeoutMs ?? this.timeoutMs;
        this.keepAlive();
        for (const [id, subscriber] of this.subscribers) this.sendSubscribe(id, subscriber.channel);
        for (const queued of this.queue.splice(0)) this.ws?.send(queued);
        return;
      case "subscribe_success":
        this.settle(message.id, null);
        return;
      case "subscribe_error":
        this.settle(message.id, new Error(`subscribe failed: ${JSON.stringify(message.errors)}`));
        return;
      case "data": {
        const subscriber = message.id ? this.subscribers.get(message.id) : undefined;
        if (!subscriber) return;
        const events = Array.isArray(message.event) ? message.event : [message.event];
        for (const event of events) {
          try {
            subscriber.onEvent(typeof event === "string" ? JSON.parse(event) : event);
          } catch (error) {
            console.error("[realtime] event handler failed", error);
          }
        }
        return;
      }
      case "publish_error":
      case "broadcast_error":
        console.warn(`[realtime] ${message.type}`, message.errors);
    }
  }

  private settle(id: string | undefined, error: Error | null) {
    const subscriber = id ? this.subscribers.get(id) : undefined;
    if (!subscriber?.settle) return;
    if (error) subscriber.settle.reject(error);
    else subscriber.settle.resolve();
    subscriber.settle = null;
  }

  private sendSubscribe(id: string, channel: string) {
    this.send({ type: "subscribe", id, channel, authorization: authorization() });
  }

  private send(message: object) {
    this.ws?.send(JSON.stringify(message));
  }

  /** AppSync sends `ka` every minute; a silent socket past the timeout is presumed dead. */
  private keepAlive() {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => this.ws?.close(), this.timeoutMs);
  }

  private reconnect() {
    this.ready = false;
    this.clearTimers();
    if (this.closed) return;
    const delay = Math.min(MAX_RETRY_MS, 500 * 2 ** this.attempts++) * (0.5 + Math.random() / 2);
    this.retry = setTimeout(() => this.open(), delay);
  }

  private clearTimers() {
    if (this.watchdog) clearTimeout(this.watchdog);
    if (this.retry) clearTimeout(this.retry);
    this.watchdog = null;
    this.retry = null;
  }
}
