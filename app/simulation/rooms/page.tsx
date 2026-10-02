"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { newCode } from "../net/types";

export default function RoomsPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const codeInput = useRef<HTMLInputElement>(null);

  // arriving from a "Join a room" button: put the cursor where it is wanted
  useEffect(() => {
    if (window.location.hash !== "#join") return;
    codeInput.current?.scrollIntoView({ block: "center" });
    codeInput.current?.focus();
  }, []);

  const create = () => {
    const c = newCode();
    try {
       sessionStorage.setItem(`campusevac:host:${c}`, "2");
    } catch {
      /* private mode: the room still works, just not across a refresh */
    }
    router.push(`/simulation/room/${c}`);
  };

  const join = () => {
    const c = code.trim().toUpperCase();
    if (c.length < 4) {
      setError("That does not look like a room code.");
      return;
    }
    router.push(`/simulation/room/${c}`);
  };

  return (
    <main className="brutal-grid relative min-h-0 flex-1 overflow-y-auto text-ink">
      <div className="mx-auto flex min-h-full max-w-5xl flex-col px-5 py-5 sm:px-8 sm:py-8">
        <nav className="flex items-center justify-between border-b-2 border-ink pb-4">
          <Link
            href="/"
            className="text-[11px] font-black uppercase tracking-[0.18em] hover:text-violet"
          >
            &lt;- back to base
          </Link>
          <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em]"><span className="signal-pulse h-2 w-2 rounded-full bg-mint" /> room control</span>
        </nav>

        <header className="grid gap-6 py-10 lg:grid-cols-[1fr_0.7fr] lg:items-end lg:py-16">
          <div>
            <div className="mb-4 inline-block border-2 border-ink bg-sun px-2 py-1 text-[10px] font-black uppercase tracking-[0.18em] shadow-[3px_3px_0_var(--ink)]">Lobby terminal / 02</div>
            <h1 className="text-5xl font-black uppercase leading-[0.88] tracking-[-0.07em] sm:text-7xl">Set the<br /><span className="text-violet">crew loose.</span></h1>
          </div>
          <p className="max-w-md border-l-4 border-violet pl-4 text-sm font-medium leading-relaxed text-ink-soft">Create a drill room, share the code, then wait for the response team. The countdown starts when every seat is filled.</p>
        </header>

        <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="brutal-panel p-5 sm:p-7">
            <div className="flex items-start justify-between gap-4 border-b-2 border-ink pb-4">
               <div><h2 className="text-xs font-black uppercase tracking-[0.2em]">New drill room</h2><p className="mt-2 text-sm font-medium text-ink-soft">You are the coordinator. Choose how many seats the drill needs.</p></div>
              <span className="font-mono text-xs font-bold text-violet">CREATE_01</span>
            </div>
             <div className="mt-6 flex flex-wrap items-end gap-5">
               <div className="border-2 border-ink bg-paper-light px-4 py-3 text-sm font-bold shadow-[3px_3px_0_var(--ink)]">2 seats: 1 evacuee + 1 warden</div>
            <button
              onClick={create}
              className="brutal-button px-5 py-3"
            >
              Open room -&gt;
            </button>
            </div>
            <p className="mt-6 max-w-lg border-t border-ink/20 pt-4 text-[11px] font-semibold leading-relaxed text-ink-soft">Wardens cover the active sectors and relay verified route guidance. Fewer participants means some sectors go unwatched. You can still start with two.</p>
          </section>

          <section id="join" className="brutal-panel-dark scroll-mt-6 p-5 text-paper sm:p-7">
            <div className="flex items-start justify-between gap-4 border-b border-paper/30 pb-4"><div><h2 className="text-xs font-black uppercase tracking-[0.2em]">Join with a code</h2><p className="mt-2 text-sm font-medium text-paper/65">Already have a crew? Drop into their signal.</p></div><span className="font-mono text-xs font-bold text-sun">JOIN_02</span></div>
            <div className="mt-6 flex flex-wrap items-end gap-4">
              <label className="flex flex-col gap-2"><span className="text-[10px] font-black uppercase tracking-widest text-paper/60">Room code</span><input ref={codeInput} value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(null); }} onKeyDown={(e) => e.key === "Enter" && join()} placeholder="ABCDE" maxLength={6} className="w-40 border-2 border-paper bg-transparent px-3 py-3 font-mono text-sm tracking-[0.3em] text-paper outline-none placeholder:text-paper/30 focus:border-sun" /></label>
              <button onClick={join} className="brutal-button-dark px-5 py-3">Join -&gt;</button>
            </div>
            {error && <p className="mt-4 border-l-2 border-danger pl-3 text-[11px] font-bold text-danger">{error}</p>}
          </section>
        </div>

        <section className="grid gap-4 py-10 sm:grid-cols-3">
          {[['01', 'Make the room', 'Pick the number of seats and open the facility.'], ['02', 'Share the signal', 'Copy the generated room link to your full crew.'], ['03', 'Watch the draw', 'Every seat starts the ten-second clock. Start now skips the wait.']].map(([n, title, text]) => <div key={n} className="border-t-2 border-ink pt-4"><span className="font-mono text-sm font-bold text-violet">{n}</span><h3 className="mt-2 text-sm font-black uppercase tracking-wide">{title}</h3><p className="mt-2 text-xs font-medium leading-relaxed text-ink-soft">{text}</p></div>)}
        </section>
      </div>
    </main>
  );
}
