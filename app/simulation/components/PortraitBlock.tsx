"use client";

import { useEffect, useSyncExternalStore } from "react";
import { enterLandscape } from "../orientation";
import { useSimulation } from "../store";
import { useCoarsePointer } from "../useCoarsePointer";

/**
 * The drill is landscape-only on a phone. In portrait the whole screen is covered by a
 * prompt to turn the phone, and a running drill is paused so no air is lost while the
 * player does it. Where the browser allows, the button also locks landscape for them.
 */
export function PortraitBlock({ onBlock }: { onBlock?: () => void }) {
  const touch = useCoarsePointer();
  const portrait = useSyncExternalStore(subscribePortrait, readPortrait, () => false);
  const blocked = touch && portrait;

  useEffect(() => {
    if (!blocked) return;
    if (onBlock) return onBlock();
    const state = useSimulation.getState();
    if (state.briefingStatus === "complete" && !state.failed && !state.assemblyConfirmed) state.setPaused(true);
  }, [blocked, onBlock]);

  if (!blocked) return null;
  return (
    <div className="pointer-events-auto absolute inset-0 z-[70] grid place-items-center bg-night p-6 text-center" role="alertdialog" aria-labelledby="rotate-title">
      <div className="flex max-w-xs flex-col items-center">
        <svg viewBox="0 0 64 64" className="rotate-phone h-20 w-20 text-sun" aria-hidden>
          <rect x="20" y="8" width="24" height="44" rx="4" fill="none" stroke="currentColor" strokeWidth="3" />
          <circle cx="32" cy="46" r="2" fill="currentColor" />
        </svg>
        <h2 id="rotate-title" className="mt-6 text-2xl font-black uppercase tracking-[-0.03em] text-paper">
          Turn your screen sideways
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-paper/70">
          CampusEvac is played in landscape on phones and tablets. Rotate to continue - if nothing happens, switch off rotation lock.
        </p>
        <button onClick={() => void enterLandscape()} className="brutal-button mt-6 px-5 py-3">
          Go full screen
        </button>
      </div>
    </div>
  );
}

const portraitQuery = () => window.matchMedia("(orientation: portrait)");
const readPortrait = () => portraitQuery().matches;
function subscribePortrait(onChange: () => void) {
  const query = portraitQuery();
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
