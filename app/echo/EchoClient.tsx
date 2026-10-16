"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import styles from "./echo.module.css";

/**
 * A simulated Alexa+ device for CampusEvac: speak (or type) to it, a Strands agent running
 * NVIDIA Nemotron answers by calling the CampusEvac MCP server (/api/echo), and Amazon Polly
 * says the answer. The ring shows what it is doing, the way an Echo's light ring does.
 */

type Ring = "idle" | "listening" | "thinking" | "speaking" | "notify" | "error";

interface ToolCall {
  name: string;
  input: unknown;
  ok: boolean;
}

interface Turn {
  who: "you" | "alexa";
  text: string;
  tools?: ToolCall[];
  screen?: boolean;
  failed?: boolean;
}

type VoiceSource = "polly" | "browser" | "off";

const SUGGESTIONS = [
  "I'm in the library and I smell smoke. Which way out?",
  "What happens if a fire starts in the cafeteria?",
  "Remember me: I'm Sam, I use a wheelchair, and I'm usually in the library.",
  "There's a fire in the Main Hall. Plan the whole evacuation.",
  "Would flashing alarms and text alerts help in that drill?",
];

/* the browser's speech recognition, which only some browsers have and TypeScript does not type */
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
}

function recognitionClass(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const noSubscription = () => () => {};

const RING_LABEL: Record<Ring, string> = {
  idle: "Ready",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking",
  notify: "You have a notification",
  error: "Something went wrong",
};

const TOOL_LABEL: Record<string, string> = {
  describe_building: "building",
  find_way_out: "way out",
  register_occupant: "save needs",
  forget_occupant: "forget",
  smoke_forecast: "smoke",
  plan_evacuation: "evacuation plan",
  list_safety_fixes: "fixes",
  get_warden_playbook: "playbook",
  start_drill: "start drill",
  get_drill_result: "drill result",
  compare_fixes: "rerun with fixes",
};

/** A soft two-note chime for "your drill is done". */
function chime() {
  try {
    const ctx = new AudioContext();
    [660, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + i * 0.18 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.18);
      osc.stop(ctx.currentTime + i * 0.18 + 0.55);
    });
  } catch {
    /* no audio: the ring still lights up */
  }
}

export default function EchoClient() {
  const [ring, setRing] = useState<Ring>("idle");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [heard, setHeard] = useState("");
  const [voice, setVoice] = useState<VoiceSource>("polly");
  // speech recognition is a browser feature: absent while rendering on the server
  const canListen = useSyncExternalStore(noSubscription, () => !!recognitionClass(), () => false);
  const [pendingDrill, setPendingDrill] = useState<string | null>(null);
  const [pollyDown, setPollyDown] = useState(false);
  const history = useRef<unknown[]>([]);
  const recognition = useRef<Recognition | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const busy = ring === "thinking" || ring === "listening";

  /** Say a reply: Polly first; the browser's own voice if Polly cannot be reached. */
  const speak = useCallback(
    async (text: string) => {
      if (voice === "off") return setRing("idle");
      setRing("speaking");
      const done = () => setRing((r) => (r === "speaking" ? "idle" : r));
      if (voice === "polly") {
        try {
          const response = await fetch("/api/speak", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text, voice: "assistant" }),
          });
          if (!response.ok) throw new Error(`Polly ${response.status}`);
          const url = URL.createObjectURL(await response.blob());
          audio.current?.pause();
          const player = new Audio(url);
          audio.current = player;
          player.onended = () => {
            URL.revokeObjectURL(url);
            done();
          };
          await player.play();
          return;
        } catch {
          setVoice("browser");
          setPollyDown(true);
        }
      }
      if ("speechSynthesis" in window) {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.onend = done;
        speechSynthesis.cancel();
        speechSynthesis.speak(utterance);
      } else done();
    },
    [voice],
  );

  const ask = useCallback(
    async (text: string) => {
      const said = text.trim();
      if (!said) return;
      audio.current?.pause();
      if (typeof window !== "undefined" && "speechSynthesis" in window) speechSynthesis.cancel();
      setTurns((t) => [...t, { who: "you", text: said }]);
      setDraft("");
      setHeard("");
      setRing("thinking");
      try {
        const response = await fetch("/api/echo", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: said, history: history.current }),
        });
        const body = (await response.json()) as { reply?: string; history?: unknown[]; tools?: ToolCall[]; show_on_screen?: boolean; drill_id?: string | null; error?: string };
        if (!response.ok || !body.reply) throw new Error(body.error ?? `HTTP ${response.status}`);
        history.current = body.history ?? history.current;
        setTurns((t) => [...t, { who: "alexa", text: body.reply!, tools: body.tools, screen: body.show_on_screen }]);
        if (body.drill_id) setPendingDrill(body.drill_id);
        await speak(body.reply);
      } catch (error) {
        const message = (error as Error).message;
        setTurns((t) => [...t, { who: "alexa", failed: true, text: `Sorry, something went wrong: ${message}` }]);
        setRing("error");
        setTimeout(() => setRing((r) => (r === "error" ? "idle" : r)), 1500);
      }
    },
    [speak],
  );

  // a drill takes minutes: watch it, and light up like an Echo notification when it is done
  useEffect(() => {
    if (!pendingDrill) return;
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/echo/drill?id=${encodeURIComponent(pendingDrill)}`);
        const body = (await response.json()) as { status?: string };
        if (body.status && body.status !== "running") {
          setPendingDrill(null);
          setRing((r) => (r === "idle" ? "notify" : r));
          chime();
        }
      } catch {
        /* try again next tick */
      }
    }, 8000);
    return () => clearInterval(timer);
  }, [pendingDrill]);

  const listen = () => {
    const Klass = recognitionClass();
    if (!Klass || busy) return;
    audio.current?.pause();
    const rec = new Klass();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = "";
    rec.onresult = (event) => {
      let text = "";
      for (let i = 0; i < event.results.length; i++) {
        text += event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText = text;
      }
      setHeard(text);
    };
    rec.onerror = () => setRing("idle");
    rec.onend = () => {
      recognition.current = null;
      if (finalText) void ask(finalText);
      else setRing((r) => (r === "listening" ? "idle" : r));
    };
    recognition.current = rec;
    setRing("listening");
    rec.start();
  };

  const notified = ring === "notify";
  const last = [...turns].reverse().find((t) => t.who === "alexa");
  const glow = ring === "notify" ? "#ffc44d" : ring === "error" ? "#ef3b4b" : "#2fd6ff";

  return (
    // the root layout locks the body to the screen for the 3D views, so this page scrolls itself
    <main className="min-h-0 flex-1 overflow-y-auto bg-night text-paper">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-6 md:px-8 md:py-10">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold tracking-[0.2em] text-sun uppercase">Simulated Alexa+</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight md:text-4xl">CampusEvac on Echo</h1>
            <p className="mt-2 max-w-xl text-sm text-paper/60">
              Ask the way out, or run a what-if fire drill by voice. A Strands agent running NVIDIA Nemotron answers by calling the CampusEvac MCP server; Amazon Polly speaks.
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs text-paper/60">
            Voice
            <select
              value={voice}
              onChange={(e) => setVoice(e.target.value as VoiceSource)}
              className="rounded-md border border-paper/15 bg-transparent px-2 py-1 text-paper"
            >
              <option value="polly" className="bg-night">Amazon Polly</option>
              <option value="browser" className="bg-night">Browser voice</option>
              <option value="off" className="bg-night">Off (read only)</option>
            </select>
          </label>
          {pollyDown && <p className="w-full text-right text-xs text-paper/45">Amazon Polly isn&apos;t reachable from this server, so the browser&apos;s voice is speaking.</p>}
        </header>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-8 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          {/* the device */}
          <section className="flex min-w-0 flex-col items-center gap-5">
            <button
              type="button"
              onClick={() => (notified ? void ask("How did the drill go?") : canListen ? listen() : undefined)}
              disabled={busy}
              aria-label={notified ? "Hear your notification" : canListen ? "Talk to Alexa" : "Alexa"}
              className={`${styles.device} mt-4 cursor-pointer disabled:cursor-default`}
            >
              <span className={`${styles.glow} ${ring !== "idle" ? styles.glowOn : ""}`} style={{ background: glow }} />
              <span className={`${styles.ring} ${styles[ring]}`} />
            </button>
            <p className="h-5 text-sm text-paper/70" aria-live="polite">
              {heard ? `“${heard}”` : RING_LABEL[ring]}
            </p>
            {notified && (
              <button type="button" onClick={() => void ask("How did the drill go?")} className="rounded-full bg-sun px-4 py-2 text-sm font-semibold text-ink">
                Your drill is done. Hear the result
              </button>
            )}
            {pendingDrill && !notified && <p className="text-xs text-paper/50">A drill is running. The ring turns yellow when it is done.</p>}

            <form
              className="flex w-full max-w-sm gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void ask(draft);
              }}
            >
              {canListen && (
                <button
                  type="button"
                  onClick={listen}
                  disabled={busy}
                  className="shrink-0 rounded-full bg-paper px-4 py-2 text-sm font-semibold text-ink disabled:opacity-40"
                >
                  🎙 Talk
                </button>
              )}
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={canListen ? "…or type" : "Type what you'd say to Alexa"}
                className="min-w-0 flex-1 rounded-full border border-paper/15 bg-paper/5 px-4 py-2 text-sm placeholder:text-paper/40 focus:border-sun focus:outline-none"
              />
              <button type="submit" disabled={busy || !draft.trim()} className="shrink-0 rounded-full border border-paper/20 px-4 py-2 text-sm disabled:opacity-40">
                Send
              </button>
            </form>
            {!canListen && <p className="text-xs text-paper/45">This browser has no speech recognition. Chrome or Edge do; typing works everywhere.</p>}

            <div className="flex max-w-sm flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={busy}
                  onClick={() => void ask(s)}
                  className="rounded-full border border-paper/15 px-3 py-1.5 text-left text-xs text-paper/75 hover:border-sun hover:text-paper disabled:opacity-40"
                >
                  {s}
                </button>
              ))}
            </div>
          </section>

          {/* the Echo Show screen and the conversation */}
          <section className="flex min-w-0 flex-col gap-4">
            <div className="rounded-2xl border border-paper/10 bg-[#0d0a12] p-5 shadow-2xl">
              <div className="mb-3 flex items-center justify-between text-[11px] tracking-[0.16em] text-paper/45 uppercase">
                <span>Echo Show</span>
                {last?.screen && <span className="rounded-full bg-mint/15 px-2 py-0.5 text-mint">Shown on screen: for a deaf user</span>}
              </div>
              <p className={`text-lg leading-relaxed md:text-xl ${last?.failed ? "text-coral" : "text-paper"}`}>
                {last?.text ?? "Try: “I'm in the library and I smell smoke. Which way out?”"}
              </p>
            </div>

            <ol className="flex flex-col gap-3" aria-label="Conversation">
              {turns.map((turn, i) => (
                <li key={i} className={turn.who === "you" ? "self-end text-right" : "self-start"}>
                  <p className={`inline-block max-w-prose rounded-2xl px-4 py-2 text-sm ${turn.who === "you" ? "bg-paper text-ink" : turn.failed ? "bg-coral/15 text-coral" : "bg-paper/8 text-paper"}`}>
                    {turn.text}
                  </p>
                  {!!turn.tools?.length && (
                    <p className="mt-1 flex flex-wrap gap-1 text-[11px]">
                      <span className="text-paper/40">MCP:</span>
                      {turn.tools.map((call, j) => (
                        <span
                          key={j}
                          title={JSON.stringify(call.input)}
                          className={`rounded-full px-2 py-0.5 font-mono ${call.ok ? "bg-violet/20 text-[#c7b8ff]" : "bg-coral/20 text-coral"}`}
                        >
                          {TOOL_LABEL[call.name] ?? call.name}
                        </span>
                      ))}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </section>
        </div>

        <footer className="text-xs text-paper/40">
          A simulation of an Alexa+ experience, made for the Amazon Developer hackathon. Drills are simulated. In a real fire, follow the building&apos;s alarm and call your local emergency number.
        </footer>
      </div>
    </main>
  );
}
