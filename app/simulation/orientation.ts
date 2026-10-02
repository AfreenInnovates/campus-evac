"use client";

/**
 * The drill is played sideways on a phone. Browsers only allow the orientation to be locked
 * from inside fullscreen, and only in response to a tap, so this is called from the taps
 * that start or resume a drill. Android Chrome honours it; iOS Safari has neither API and
 * relies on the portrait block in `DrillShell` instead. Every step is best effort.
 */
export async function enterLandscape() {
  if (typeof window === "undefined" || !window.matchMedia("(pointer: coarse)").matches) return;
  const root = document.documentElement;
  try {
    if (!document.fullscreenElement && root.requestFullscreen) {
      await root.requestFullscreen({ navigationUI: "hide" });
    }
  } catch {
    /* fullscreen refused, e.g. iOS or an embedded frame */
  }
  try {
    // not in every TypeScript DOM lib yet, hence the narrow cast
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (orientation: "landscape") => Promise<void>;
    };
    await orientation.lock?.("landscape");
  } catch {
    /* lock refused: the portrait block still asks the player to turn the phone */
  }
}
