"use client";

import { useState } from "react";
import { humanBroadcast, lab, readOrder, useLab, type WardenMode } from "./engine";
import { isRelative, routeRooms, STATUS_LABEL, type OrderStatus } from "./orders";
import { placeName } from "./world";

/**
 * The two panels of the simple view: what the people are thinking, and what the warden told
 * each of them - with whether they are doing it. Together they are the coordination, visible.
 */

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

export const STATUS_STYLE: Record<OrderStatus, { icon: string; color: string }> = {
  heard: { icon: "…", color: "rgba(248,242,234,0.6)" },
  following: { icon: "✓", color: "var(--mint)" },
  ignored: { icon: "✗", color: "var(--danger)" },
  done: { icon: "✓✓", color: "var(--mint)" },
};

function Box({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="hud-panel pointer-events-auto flex max-h-full min-h-0 flex-col p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-[11px] font-black uppercase tracking-[0.16em] text-sun">{title}</h2>
        {hint && <span className="text-[10px] text-paper/45">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

/** Every decision as it is made: who, what, and why in their own words. */
export function ThoughtsFeed() {
  const log = useLab((s) => s.snap?.log);
  const agents = useLab((s) => s.snap?.agents);
  const entries = (log ?? []).filter((entry) => entry.kind === "agent").slice(0, 14);
  return (
    <Box title="What people are thinking" hint="each one is an AI">
      {entries.length ? (
        <ul className="-mr-2 min-h-0 space-y-2 overflow-y-auto pr-2">
          {entries.map((entry, i) => {
            const agent = agents?.find((a) => a.id === entry.agent);
            const [action, thought] = entry.text.split(" — ");
            const order = agent?.order;
            return (
              <li key={`${entry.t}-${entry.agent}-${i}`} className={`border-l-4 bg-night/50 px-2 py-1.5 ${i === 0 ? "hud-rise" : ""}`} style={{ borderLeftColor: agent?.color ?? "#888" }}>
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <b className="truncate">{action.replace(/^(\S+) \(#(\d+)\)/, "#$2 $1")}</b>
                  <span className="shrink-0 font-mono text-[9px] text-paper/40">{clock(entry.t)}</span>
                </div>
                {thought && <p className="mt-0.5 text-[12px] italic leading-snug text-paper/80">{thought}</p>}
                {order && (
                  <div className="mt-0.5 text-[10px] font-bold" style={{ color: STATUS_STYLE[order.status].color }}>
                    {STATUS_STYLE[order.status].icon} Warden said: {order.target.label} · {STATUS_LABEL[order.status]}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[12px] text-paper/50">The alarm just went off. Everyone is deciding what to do…</p>
      )}
    </Box>
  );
}

const QUICK = [
  "Everyone: leave by the nearest green FIRE EXIT.",
  "Library: use the WEST FIRE EXIT.",
  "Cafeteria: use the EAST FIRE EXIT.",
  "Avoid the Central Corridor.",
  "If every way out is smoky: shut the door and shelter.",
];

/** One line on how an order will be understood, so a human warden can fix it before sending. */
function OrderPreview({ text }: { text: string }) {
  if (!text.trim()) return <p className="mt-1 text-[10px] text-paper/45">Start with numbers (#3 #5: or #10 go west) to give those people an order you can track.</p>;
  const { people, target } = readOrder(text);
  const who = people.length ? people.map((id) => `#${id}`).join(", ") : "everyone (PA)";
  if (isRelative(text) && !target)
    return <p className="mt-1 text-[10px] text-danger">Left and right depend on which way someone is facing. Use north, south, east, west, or name a room or exit.</p>;
  if (!target) return <p className="mt-1 text-[10px] text-sun">To {who}: no destination recognised. They will hear it, but nobody can tell whether they follow it.</p>;
  // whoever would have to go through the burning room to get there
  const fire = lab.scenario?.origin;
  const through = people.filter((id) => {
    const person = lab.agents.find((a) => a.id === id);
    return !!person && !!fire && person.room !== fire && routeRooms(person.room, target, fire).includes(fire);
  });
  if (through.length)
    return (
      <p className="mt-1 text-[10px] text-danger">
        To {who} → {target.label} · the only way there for {through.map((id) => `#${id}`).join(", ")} runs through the fire
      </p>
    );
  return (
    <p className="mt-1 text-[10px] text-mint">
      To {who} → {target.label}
      {people.length ? " · tracked" : " · tracked only when sent to people by number"}
    </p>
  );
}

function OrderBox() {
  const [draft, setDraft] = useState("");
  return (
    <div className="mt-2 border-t border-paper/10 pt-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          humanBroadcast(draft);
          setDraft("");
        }}
        className="flex gap-1.5"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="#3 #5: go to the West Fire Exit"
          className="min-w-0 flex-1 border-2 border-paper/25 bg-night px-2 py-1.5 text-[12px] text-paper placeholder:text-paper/35"
        />
        <button className="brutal-button shrink-0 px-3 py-1.5 text-[11px]">Send</button>
      </form>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {QUICK.map((phrase) => (
          <button key={phrase} type="button" onClick={() => setDraft(phrase)} className="border border-paper/25 px-1.5 py-0.5 text-[10px] text-paper/70 hover:border-sun hover:text-paper">
            {phrase}
          </button>
        ))}
      </div>
      <OrderPreview text={draft} />
    </div>
  );
}

/** What the warden said to everyone, and to each person, and whether they are doing it. */
export function OrdersPanel({ mode }: { mode: WardenMode }) {
  const agents = useLab((s) => s.snap?.agents);
  const log = useLab((s) => s.snap?.log);
  const lastPa = (log ?? []).find((entry) => (entry.kind === "warden" || entry.kind === "human") && entry.event?.type === "announce" && !entry.event.people);
  const ordered = (agents ?? []).filter((a) => a.order);
  const count = (status: OrderStatus) => ordered.filter((a) => a.order!.status === status).length;
  const waiting = (agents ?? []).filter((a) => !a.order && a.status === "inside").length;

  if (mode === "none")
    return (
      <Box title="No warden">
        <p className="text-[12px] leading-snug text-paper/70">Nobody is giving directions. People only have the signs, the smoke and each other.</p>
      </Box>
    );

  return (
    <Box title={mode === "human" ? "Your orders" : "Warden's orders"} hint="is each person doing it?">
      {lastPa?.event?.type === "announce" && (
        <div className="mb-2 border-l-4 border-sun bg-night/50 px-2 py-1.5 text-[12px] leading-snug">
          <span className="mr-1 font-mono text-[9px] text-paper/40">{clock(lastPa.t)} to everyone</span>“{lastPa.event.text}”
        </div>
      )}
      <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-bold">
        <span style={{ color: STATUS_STYLE.following.color }}>✓ {count("following")} following</span>
        <span style={{ color: STATUS_STYLE.ignored.color }}>✗ {count("ignored")} not</span>
        <span style={{ color: STATUS_STYLE.done.color }}>✓✓ {count("done")} done</span>
        {waiting > 0 && <span className="text-paper/45">{waiting} without an order</span>}
      </div>
      {ordered.length ? (
        <ul className="-mr-2 min-h-0 space-y-1.5 overflow-y-auto pr-2">
          {ordered.map((a) => {
            const style = STATUS_STYLE[a.order!.status];
            return (
              <li key={a.id} className="border-l-4 bg-night/50 px-2 py-1.5" style={{ borderLeftColor: a.color, opacity: a.status === "inside" ? 1 : 0.6 }}>
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="truncate">
                    <b>#{a.id} {a.name}</b> → {a.order!.target.label}
                  </span>
                  <span className="shrink-0 font-black" style={{ color: style.color }}>
                    {style.icon} {STATUS_LABEL[a.order!.status]}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-[10px] text-paper/50">
                  {a.status === "safe" ? "Safe outside" : a.status === "down" ? "Collapsed" : `Now in the ${placeName(a.room)}`}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[12px] text-paper/50">{mode === "human" ? "Type an order below, e.g. “#3 #5: go to the West Fire Exit”." : "The warden has not given anyone an order yet."}</p>
      )}
      {mode === "human" && <OrderBox />}
    </Box>
  );
}
