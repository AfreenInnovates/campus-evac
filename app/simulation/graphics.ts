"use client";

import { useSyncExternalStore } from "react";

/**
 * The post-processing pass (bloom, ambient occlusion, vignette) is on by default on desktop
 * and off on touch devices. The pause menu can flip it either way; the choice sticks.
 */
export type GraphicsQuality = "high" | "low";

const KEY = "campusevac:graphics";
const listeners = new Set<() => void>();

function read(): GraphicsQuality | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === "high" || value === "low" ? value : null;
  } catch {
    return null;
  }
}

let current: GraphicsQuality | null = typeof window === "undefined" ? null : read();

export function setGraphicsQuality(value: GraphicsQuality) {
  current = value;
  try {
    localStorage.setItem(KEY, value);
  } catch {
    /* lasts for this page only */
  }
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/**
 * Set when the frame rate has fallen behind on the default setting. It lasts for the page
 * only and never overrides an explicit choice from the menu.
 */
let struggling = false;

export function reportStruggling() {
  if (struggling || current !== null) return;
  struggling = true;
  listeners.forEach((listener) => listener());
}

/** The chosen quality, or the device default when nothing was chosen. */
export function useGraphicsQuality(touch: boolean): GraphicsQuality {
  const chosen = useSyncExternalStore(subscribe, () => current, () => null);
  const slow = useSyncExternalStore(subscribe, () => struggling, () => false);
  return chosen ?? (touch || slow ? "low" : "high");
}
