type Signal = "command" | "alert" | "evidence" | "jump";

let context: AudioContext | null = null;
let unlockBound = false;

/**
 * Browsers start an AudioContext suspended until the page has seen a real gesture, and
 * the briefing auto-plays on a timer rather than a click. Without this the first drill
 * would run in silence with no error anywhere. Binding once on the first context keeps
 * every later resume free.
 */
function bindUnlock() {
  if (unlockBound || typeof window === "undefined") return;
  unlockBound = true;
  const resume = () => {
    if (context && context.state !== "running") void context.resume();
  };
  for (const event of ["pointerdown", "keydown", "touchstart"]) {
    window.addEventListener(event, resume, { passive: true });
  }
}

/** Shared by the signal beeps and the narration player, so there is only ever one unlock. */
export function getAudioContext() {
  if (typeof window === "undefined") return null;
  context ??= new AudioContext();
  bindUnlock();
  if (context.state === "suspended") void context.resume();
  return context;
}

const getContext = getAudioContext;

/** Deterministic local cues keep critical feedback available without audio services. */
export function playSignal(signal: Signal) {
  const audio = getContext();
  if (!audio) return;
  const now = audio.currentTime;
  const frequencies =
    signal === "alert"
      ? [110, 82]
      : signal === "jump"
        ? [150, 210]
      : signal === "evidence"
        ? [520, 760]
        : [240, 420];
  const duration = signal === "alert" ? 0.22 : signal === "jump" ? 0.08 : 0.1;

  frequencies.forEach((frequency, index) => {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = signal === "alert" ? "sawtooth" : signal === "jump" ? "triangle" : "square";
    const start = now + index * duration * 0.8;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.045, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  });
}
