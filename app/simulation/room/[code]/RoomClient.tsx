"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import DrillShell from "../../DrillShell";
import { roomById } from "../../level";
import { COUNTDOWN_MS, type DrillRoom } from "../../net/types";
import { resolveRoom, useSession } from "../../session";
import { useSimulation } from "../../store";

const NAME_KEY = "campusevac:name";
const noSubscribe = () => () => {};

function useStored<T>(read: () => T, serverValue: T): T {
  return useSyncExternalStore(noSubscribe, read, () => serverValue);
}

function useCountdown(startsAt: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startsAt === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 150);
    return () => window.clearInterval(timer);
  }, [startsAt]);
  if (startsAt === null) return null;
  return Math.max(0, Math.ceil((startsAt - now) / 1000));
}

export default function RoomClient({ code }: { code: string }) {
  const router = useRouter();
  const connect = useSession((state) => state.connect);
  const leave = useSession((state) => state.leave);
  const disconnect = useSession((state) => state.disconnect);
  const startNow = useSession((state) => state.startNow);
  const startError = useSession((state) => state.startError);
  const status = useSession((state) => state.status);
  const rawRoom = useSession((state) => state.room);
  const myId = useSession((state) => state.myId);
  const isHost = useSession((state) => state.isHost);
  const [edited, setEdited] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);

  const readName = useCallback(() => {
    try { return localStorage.getItem(NAME_KEY) ?? ""; } catch { return ""; }
  }, []);
  const readHost = useCallback(() => {
    try { return sessionStorage.getItem(`campusevac:host:${code}`) !== null; } catch { return false; }
  }, [code]);
  const readLink = useCallback(() => `${window.location.origin}/simulation/room/${code}`, [code]);
  const readShare = useCallback(() => typeof navigator.share === "function", []);
  const storedName = useStored(readName, "");
  const isHostInvite = useStored(readHost, false);
  const link = useStored(readLink, "");
  const canShare = useStored(readShare, false);
  const name = edited ?? storedName;

  useEffect(() => () => disconnect(), [disconnect]);
  const countdown = useCountdown(rawRoom?.phase === "preparing" ? rawRoom.startsAt : null);
  const room = resolveRoom(rawRoom);
  const me = room?.participants.find((participant) => participant.id === myId) ?? null;

  useEffect(() => {
    if (room?.phase !== "active" || !me?.role) return;
    const sim = useSimulation.getState();
    sim.reset();
    sim.setMode(
      me.role === "evacuee"
        ? { kind: "evacuee" }
        : { kind: "warden", sectorId: me.sectorId ?? "sec" },
    );
  }, [me?.role, me?.sectorId, room?.phase]);

  const join = async () => {
    if (joining) return;
    const participantName = name.trim() || `participant-${Math.floor(Math.random() * 900 + 100)}`;
    try { localStorage.setItem(NAME_KEY, participantName); } catch { /* optional preference */ }
    setJoining(true);
    const seed: DrillRoom | undefined = isHostInvite
      ? {
          drillId: `drill_${code}`,
          code,
          hostId: "",
          maxPlayers: 2,
          phase: "lobby",
          startsAt: null,
          participants: [],
          createdAt: Date.now(),
          scenarioVersion: "campus-block-v1",
          seed: 18421,
          outcome: null,
        }
      : undefined;
    try { await connect(code, participantName, seed); } finally { setJoining(false); }
  };

  const copyLink = async () => {
    if (!link) return;
    try {
      await navigator.clipboard?.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { setCopied(false); }
  };

  const shareLink = async () => {
    if (!link) return;
    if (navigator.share) {
      try { await navigator.share({ title: `Join drill ${code}`, text: "Join our CampusEvac drill", url: link }); return; }
      catch (error) { if (error instanceof DOMException && error.name === "AbortError") return; }
    }
    await copyLink();
  };

  const leaveAndGo = () => { leave(); router.push("/simulation/rooms"); };
  const backAction = status === "connected" ? leaveAndGo : undefined;

  if (status === "idle") {
    return <Frame code={code} onBack={backAction}><div className="mb-4 inline-block border-2 border-ink bg-sun px-2 py-1 text-[10px] font-black uppercase tracking-[0.18em] shadow-[3px_3px_0_var(--ink)]">Drill access</div><h1 className="text-4xl font-black uppercase leading-none tracking-[-0.06em] sm:text-5xl">{isHostInvite ? "Open your drill" : "Join drill"} <span className="font-mono text-violet">{code}</span></h1><p className="mt-4 max-w-lg border-l-4 border-violet pl-4 text-sm font-medium leading-relaxed text-ink-soft">{isHostInvite ? "Share the invite, then wait for one warden to join." : "Pick a display name and join the two-person evacuation drill."}</p><div className="mt-8 flex flex-wrap gap-4"><input value={name} onChange={(event) => setEdited(event.target.value)} onKeyDown={(event) => event.key === "Enter" && join()} placeholder="your name" maxLength={16} className="brutal-input w-56 px-3 py-3 text-sm font-bold outline-none" /><button onClick={join} disabled={joining} className="brutal-button px-5 py-3 disabled:cursor-wait disabled:opacity-50">{joining ? "Connecting..." : isHostInvite ? "Open drill ->" : "Join ->"}</button></div></Frame>;
  }

  if (status === "connecting") {
    return <Frame code={code} onBack={backAction}><div className="flex items-center gap-3 border-2 border-ink bg-sun p-4 shadow-[4px_4px_0_var(--ink)]"><span className="signal-pulse h-3 w-3 rounded-full bg-violet" /><div><p className="text-xs font-black uppercase tracking-widest">Connecting to drill</p><p className="mt-1 text-xs font-medium text-ink-soft">Joining the AWS realtime room for {code}...</p></div></div></Frame>;
  }

  if (["notfound", "full", "unavailable", "timeout", "connection"].includes(status)) {
    const unavailable = status === "timeout" || status === "connection";
    return <Frame code={code} onBack={backAction}><div className="mb-4 inline-block border-2 border-ink bg-danger px-2 py-1 text-[10px] font-black uppercase tracking-[0.18em] shadow-[3px_3px_0_var(--ink)]">{unavailable ? "Signal unavailable" : "Drill error"}</div><h1 className="text-4xl font-black uppercase leading-none tracking-[-0.06em] sm:text-5xl">{unavailable ? "Could not reach drill" : status === "full" ? "Drill is full" : status === "unavailable" ? "Drill is unavailable" : "No such drill"}</h1><p className="mt-4 max-w-lg border-l-4 border-danger pl-4 text-sm font-medium leading-relaxed text-ink-soft">{status === "timeout" ? "The room took too long to respond. Try the invite again." : status === "connection" ? "The room service could not be reached. Check the connection and try again." : status === "full" ? "Both drill seats are occupied." : status === "unavailable" ? "This drill is no longer accepting participants." : "Check the invite code or ask the coordinator to open a new drill."}</p><Link href="/simulation/rooms" className="brutal-button mt-8 px-5 py-3">Back to drills -&gt;</Link></Frame>;
  }

  if (["active", "assembly", "failed", "reported"].includes(room?.phase ?? "") && me?.role) {
    return <main className="relative flex-1"><DrillShell title={me.role === "evacuee" ? `Evacuee / drill ${code}` : `Warden / ${roomById(me.sectorId ?? "sec").name} / drill ${code}`} /></main>;
  }

  if (room?.phase === "failed" || room?.phase === "reported") {
    return <Frame code={code} onBack={backAction}><div className="mb-4 inline-block border-2 border-ink bg-danger px-2 py-1 text-[10px] font-black uppercase tracking-[0.18em] shadow-[3px_3px_0_var(--ink)]">Training outcome</div><h1 className="text-4xl font-black uppercase leading-none tracking-[-0.06em] sm:text-5xl">This drill is complete</h1><p className="mt-4 max-w-lg border-l-4 border-danger pl-4 text-sm font-medium leading-relaxed text-ink-soft">Review the coordination timeline, then open a new drill for a focused replay.</p><button onClick={leaveAndGo} className="brutal-button mt-8 px-5 py-3">Back to drills -&gt;</button></Frame>;
  }

  const participants = room?.participants ?? [];
  const enough = !!room && participants.length >= room.maxPlayers;
  const hostCanStart = isHost && (room?.phase === "lobby" || room?.phase === "preparing") && enough && !starting;
  const waiting = room?.phase === "preparing" ? "Preparing the authored scenario." : enough ? "Both seats are ready. The drill will start at zero." : `Waiting for ${room ? room.maxPlayers - participants.length : 1} more participant.`;
  const startErrorMessage = startError === "not-host" ? "Coordinator permission changed." : startError === "not-ready" ? "Waiting for the other role." : startError === "started" ? "The drill is already starting." : startError ? "The drill is no longer available." : null;

  return <Frame code={code} onBack={backAction}><div className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-ink pb-5"><div><div className="mb-3 inline-block bg-ink px-2 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-sun">Drill lobby / AWS realtime</div><h1 className="text-4xl font-black uppercase leading-none tracking-[-0.06em] sm:text-5xl">Drill <span className="font-mono text-violet">{code}</span></h1></div><span className="border-2 border-ink bg-sun px-3 py-2 text-[11px] font-black uppercase tracking-widest shadow-[3px_3px_0_var(--ink)]">{participants.length}/2 seats</span></div><div className="mt-6 flex flex-col gap-3 sm:flex-row"><input readOnly value={link} aria-label="Drill invite link" className="brutal-input w-full max-w-xl px-3 py-3 font-mono text-xs text-ink-soft outline-none sm:flex-1" /><button onClick={copyLink} disabled={!link} className="brutal-button px-4 py-3 disabled:opacity-50">{copied ? "Copied" : "Copy link"}</button>{canShare && <button onClick={shareLink} className="brutal-button px-4 py-3">Share</button>}</div><p className="mt-3 text-[10px] font-bold uppercase tracking-[0.16em] text-ink-soft">One evacuee and one warden share this incident with different information.</p><ul className="mt-8 grid gap-3 sm:grid-cols-2">{participants.map((participant) => <li key={participant.id} className="flex items-center justify-between border-2 border-ink bg-paper-light px-4 py-3 text-sm shadow-[3px_3px_0_var(--ink)]"><span className={participant.id === myId ? "font-black" : "font-semibold text-ink-soft"}>{participant.name}{participant.id === room?.hostId && <span className="ml-2 text-[10px] font-black uppercase tracking-widest text-violet">coordinator</span>}</span><span className="text-[10px] font-black uppercase tracking-widest text-mint">{participant.id === myId ? "you" : participant.connected === false ? "reconnecting" : "ready"}</span></li>)}</ul><div className="mt-8 flex flex-wrap items-start gap-4">{room?.phase === "preparing" ? <div className="flex items-baseline gap-3 border-2 border-ink bg-ink px-4 py-3 text-paper shadow-[4px_4px_0_var(--violet)]"><span className="font-mono text-5xl font-black text-sun">{countdown ?? Math.ceil(COUNTDOWN_MS / 1000)}</span><span className="text-[10px] font-black uppercase tracking-widest text-paper/70">scenario ready</span></div> : <div className="border-l-4 border-violet pl-3 text-xs font-bold text-ink-soft" role="status" aria-live="polite">{waiting}</div>}{isHost && room?.phase !== "active" && <div className="flex flex-wrap items-center gap-3 border-2 border-ink bg-paper-light p-2 shadow-[4px_4px_0_var(--ink)]"><span className="px-1 text-[10px] font-black uppercase tracking-widest text-violet">Coordinator</span><button onClick={async () => { if (!hostCanStart) return; setStarting(true); await startNow(); setStarting(false); }} disabled={!hostCanStart} className="brutal-button px-4 py-3 disabled:opacity-45">{starting ? "Starting..." : enough ? "Start now ->" : "Start when ready"}</button></div>}</div>{startErrorMessage && <p className="mt-3 border-l-2 border-danger pl-3 text-[11px] font-bold text-danger" role="alert">{startErrorMessage}</p>}<div className="mt-6 flex flex-wrap items-center gap-3"><button onClick={leaveAndGo} className="border-2 border-ink bg-transparent px-3 py-2 text-[10px] font-black uppercase tracking-widest hover:bg-ink hover:text-paper">Leave drill</button><span className="text-[10px] font-semibold uppercase tracking-widest text-ink-soft">Your seat is kept if you refresh.</span></div></Frame>;
}

function Frame({ code, children, onBack }: { code: string; children: React.ReactNode; onBack?: () => void }) {
  return <main className="brutal-grid relative min-h-0 flex-1 overflow-y-auto text-ink"><div className="mx-auto flex min-h-full max-w-5xl flex-col px-5 py-5 sm:px-8 sm:py-8"><Link href="/simulation/rooms" onClick={onBack} className="border-b-2 border-ink pb-4 text-[11px] font-black uppercase tracking-[0.18em] hover:text-violet">&lt;- drills</Link><div className="mt-12 max-w-3xl">{children}</div><div className="mt-auto pt-16 text-[10px] font-bold uppercase tracking-[0.16em] text-ink-soft">drill / {code} / AWS AppSync Events</div></div></main>;
}
