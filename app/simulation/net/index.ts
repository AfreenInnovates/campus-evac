"use client";

import { EventsNet } from "./eventsNet";
import type { NetClient } from "./types";

/** Drill rooms run over AWS AppSync Events (see infra/). */
export function createNet(): NetClient {
  return new EventsNet();
}

export * from "./types";
