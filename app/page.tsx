import Link from "next/link";
import Image from "next/image";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AiBrain01Icon,
  AlarmSmokeIcon,
  ArrowRight02Icon,
  Backpack01Icon,
  CctvCameraIcon,
  CheckmarkBadge01Icon,
  ClipboardListIcon,
  Database01Icon,
  Diamond01Icon,
  DiceIcon,
  DoorOpenIcon,
  EyeIcon,
  FirstAidKitIcon,
  FlashIcon,
  GasPipeIcon,
  IdentityCardIcon,
  KeyboardIcon,
  Megaphone01Icon,
  Mouse01Icon,
  Navigation03Icon,
  Search01Icon,
  Timer02Icon,
  UserAdd01Icon,
  UserGroupIcon,
  WifiConnected01Icon,
  WorkoutRunIcon,
} from "@hugeicons/core-free-icons";
import { DepthScene, Reveal, Tilt } from "./components/Depth";
import mascotImg from "../public/mascot.webp";
import facilityImg from "../public/facility.webp";

/* -- content ------------------------------------------------------------ */

const TICKER = [
  "Two players",
  "One building",
  "Smoke reaches the east route at 52 seconds",
  "The warden sees what you can't",
  "No game server",
  "Runs in a browser tab",
  "Training simulation only",
];

const STATS = [
  { value: "2", unit: "roles", label: "Evacuee inside, warden above", tone: "bg-sun", icon: UserGroupIcon },
  { value: "7", unit: "steps", label: "Six objectives, then the exit", tone: "bg-mint", icon: ClipboardListIcon },
  { value: "8", unit: "min", label: "A full drill, start to debrief", tone: "bg-violet text-paper", icon: Timer02Icon },
];

const STEPS = [
  { n: "01", icon: UserAdd01Icon, title: "Open a room", body: "Create a two-seat drill and share the five-letter code or the invite link." },
  { n: "02", icon: DiceIcon, title: "Get your role", body: "A ten-second countdown draws one evacuee and one warden. Nobody picks." },
  { n: "03", icon: Megaphone01Icon, title: "Hear the briefing", body: "A narrated briefing covers the route and the controls. Movement unlocks when it ends." },
  { n: "04", icon: CheckmarkBadge01Icon, title: "Evacuate, then debrief", body: "Clear every objective, reach the marked exit, and answer three debrief questions." },
];

const OBJECTIVES = [
  { label: "Emergency backpack", place: "Main foyer", color: "bg-violet text-paper", icon: Backpack01Icon },
  { label: "Lab access card", place: "Chemistry Lab 1A", color: "bg-sun", icon: IdentityCardIcon },
  { label: "Gas isolation valve", place: "Under the fume hood", color: "bg-danger text-paper", icon: GasPipeIcon },
  { label: "First-aid kit", place: "Beside the lab window", color: "bg-coral", icon: FirstAidKitIcon },
  { label: "Lab safety clue", place: "Chemistry workstation", color: "bg-mint", icon: Search01Icon },
  { label: "Emergency route guide", place: "Classroom A201", color: "bg-violet text-paper", icon: Navigation03Icon },
  { label: "Marked exit", place: "Back at the foyer", color: "bg-mint", icon: DoorOpenIcon },
];

const STACK = [
  { name: "AppSync Events", icon: WifiConnected01Icon, body: "Managed WebSocket pub/sub. Lobby, warden commands and 12 position updates a second." },
  { name: "DynamoDB", icon: Database01Icon, body: "Every lobby action and command written as an event log, expired after seven days." },
  { name: "Bedrock", icon: AiBrain01Icon, body: "Optional Nova narration for the briefing, with an authored fallback when it is off." },
];

/* -- page --------------------------------------------------------------- */

export default function Home() {
  return (
    <main className="brutal-grid relative min-h-0 flex-1 overflow-y-auto text-ink">
      {/* --------------- NAV --------------- */}
      <nav className="sticky top-0 z-30 border-b-[3px] border-ink bg-paper/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-4 px-5 py-3 sm:px-8">
          <Link href="/" className="flex items-center gap-2.5 text-sm font-black uppercase tracking-[0.14em]">
            <span className="grid h-9 w-9 place-items-center border-[3px] border-ink bg-sun shadow-[3px_3px_0_var(--ink)]">
              <svg width="18" height="16" viewBox="0 0 18 16" fill="none" aria-hidden>
                <path d="M2 8h8" stroke="var(--ink)" strokeWidth="3" />
                <path d="M8 3.5 13.5 8 8 12.5z" fill="var(--ink)" />
                <path d="M15 2v12" stroke="var(--ink)" strokeWidth="3" />
              </svg>
            </span>
            <span>
              Campus<span className="text-coral">Evac</span>
            </span>
          </Link>

          <div className="flex items-center gap-5">
            <a href="#how" className="hidden text-[10px] font-black uppercase tracking-[0.16em] text-ink-soft hover:text-ink md:block">How it works</a>
            <a href="#roles" className="hidden text-[10px] font-black uppercase tracking-[0.16em] text-ink-soft hover:text-ink md:block">Roles</a>
            <a href="#objectives" className="hidden text-[10px] font-black uppercase tracking-[0.16em] text-ink-soft hover:text-ink md:block">Objectives</a>
            <Link href="/simulation/crowd" className="hidden border-[3px] border-ink bg-sun px-4 py-2 text-[10px] font-black uppercase tracking-[0.16em] shadow-[3px_3px_0_var(--ink)] hover:bg-ink hover:text-paper sm:block">AI Crowd Lab</Link>
            <Link href="/simulation/play" className="hidden border-[3px] border-ink bg-paper-light px-4 py-2 text-[10px] font-black uppercase tracking-[0.16em] shadow-[3px_3px_0_var(--ink)] hover:bg-ink hover:text-paper sm:block">Practice solo</Link>
            <Link href="/simulation/rooms" className="brutal-button gap-2 whitespace-nowrap border-[3px] px-4 py-2 text-[10px]">
              Start a drill
              <HugeiconsIcon icon={ArrowRight02Icon} size={15} strokeWidth={2.6} />
            </Link>
          </div>
        </div>
      </nav>

      {/* --------------- TICKER --------------- */}
      <div className="brutal-ticker" aria-hidden>
        <div className="brutal-ticker__track">
          {[0, 1].map((copy) => (
            <div key={copy} className="flex shrink-0 items-center">
              {TICKER.map((item) => (
                <span key={item} className="flex items-center gap-5 whitespace-nowrap px-5 py-2 text-[11px] font-black uppercase tracking-[0.2em] text-paper">
                  {item}
                  <HugeiconsIcon icon={Diamond01Icon} size={13} strokeWidth={2.8} className="text-sun" />
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-[1200px] px-5 sm:px-8">
        {/* --------------- HERO --------------- */}
        <DepthScene className="grid items-center gap-12 py-12 lg:grid-cols-[1.05fr_0.95fr] lg:py-16">
          <div className="depth-layer flex flex-col items-start" style={{ "--depth": 0.4 } as React.CSSProperties}>
            <div className="mb-6 flex flex-wrap items-center gap-3">
              <span className="brutal-sticker bg-ink text-sun -rotate-2">
                <HugeiconsIcon icon={AlarmSmokeIcon} size={15} strokeWidth={2.6} />
                Co-op evacuation drill
              </span>
              <span className="brutal-sticker bg-paper-light rotate-1">
                <HugeiconsIcon icon={EyeIcon} size={15} strokeWidth={2.6} />
                3D in the browser
              </span>
            </div>

            <h1 className="text-[clamp(3.2rem,9vw,7.5rem)] font-black uppercase leading-[0.82] tracking-[-0.06em]">
              Two views.
              <br />
              One <span className="text-coral">safe</span>
              <br />
              <span className="inline-block border-[3px] border-ink bg-sun px-3 shadow-[8px_8px_0_var(--ink)]">exit.</span>
            </h1>

            <p className="mt-9 max-w-lg text-base font-medium leading-relaxed">
              A two-player evacuation drill on a stylised university campus. One of you is inside the building with no
              map. The other watches from above and can see the smoke spreading. Neither of you finishes alone.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link href="/simulation/rooms" className="brutal-button gap-2.5 border-[3px] px-7 py-4 text-[12px] shadow-[6px_6px_0_var(--ink)]">
                Start a drill
                <HugeiconsIcon icon={ArrowRight02Icon} size={19} strokeWidth={2.6} />
              </Link>
              <Link
                href="/simulation/play"
                className="inline-flex items-center gap-2.5 border-[3px] border-ink bg-paper-light px-7 py-4 text-[12px] font-black uppercase tracking-[0.16em] shadow-[6px_6px_0_var(--ink)] transition hover:bg-ink hover:text-paper active:translate-x-[3px] active:translate-y-[3px] active:shadow-[2px_2px_0_var(--ink)]"
              >
                <HugeiconsIcon icon={WorkoutRunIcon} size={19} strokeWidth={2.6} />
                Practice solo
              </Link>
              <Link href="/simulation/rooms#join" className="text-[12px] font-black uppercase tracking-[0.16em] underline decoration-[3px] underline-offset-4 hover:text-violet">
                Join with a code
              </Link>
            </div>
            <Link
              href="/simulation/crowd"
              className="mt-6 flex max-w-lg items-center gap-3 border-[3px] border-ink bg-ink px-4 py-3 text-paper shadow-[6px_6px_0_var(--sun)] transition hover:-translate-y-0.5"
            >
              <span className="brutal-tag shrink-0 bg-sun text-ink">New</span>
              <span className="text-[12px] font-bold leading-snug">
                <b className="uppercase tracking-[0.08em]">AI Crowd Lab:</b> a crowd of NVIDIA Nemotron agents evacuates while an AI warden watches the CCTV and
                directs them. Run the experiment.
              </span>
              <HugeiconsIcon icon={ArrowRight02Icon} size={18} strokeWidth={2.6} className="shrink-0 text-sun" />
            </Link>
          </div>

          <div className="relative mx-auto w-full max-w-xl lg:max-w-none">
            <Tilt className="brutal-screen tilt-shadow-coral" max={6}>
              <div className="flex items-center justify-between border-b-[3px] border-ink bg-ink px-3 py-2 text-[9px] font-black uppercase tracking-[0.2em] text-paper">
                <span className="flex items-center gap-2">
                  <HugeiconsIcon icon={CctvCameraIcon} size={14} strokeWidth={2.6} className="text-sun" />
                  Science Block / Level 1
                </span>
                <span className="flex items-center gap-1.5 text-mint">
                  <span className="signal-pulse h-1.5 w-1.5 rounded-full bg-mint" /> drill live
                </span>
              </div>
              <Image
                src={facilityImg}
                alt="Cutaway view of the campus block: a student running through a smoke-filled corridor toward the assembly beacon, watched from a console."
                className="h-auto w-full"
                sizes="(max-width: 1024px) 100vw, 560px"
                priority
              />
            </Tilt>

            <span
              className="brutal-sticker depth-layer absolute -bottom-4 left-4 rotate-[-3deg] bg-sun sm:left-8"
              style={{ "--depth": 2.2 } as React.CSSProperties}
            >
              <HugeiconsIcon icon={Megaphone01Icon} size={14} strokeWidth={2.6} />
              Talk them out
            </span>

            <Image
              src={mascotImg}
              alt=""
              width={188}
              height={254}
              className="depth-layer pointer-events-none absolute -left-20 top-16 hidden rotate-[-6deg] drop-shadow-[6px_6px_0_rgba(29,22,38,0.22)] xl:block"
              style={{ "--depth": 3 } as React.CSSProperties}
              priority
            />
          </div>
        </DepthScene>

        {/* --------------- STATS --------------- */}
        <Reveal>
        <section className="grid border-[3px] border-ink shadow-[10px_10px_0_var(--ink)] sm:grid-cols-3">
          {STATS.map((stat, index) => (
            <div
              key={stat.unit}
              className={`${stat.tone} border-ink p-6 transition-transform duration-300 hover:-translate-y-1 ${index < 2 ? "border-b-[3px] sm:border-b-0 sm:border-r-[3px]" : ""}`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-baseline gap-2">
                  <span className="text-5xl font-black leading-none tracking-tighter">{stat.value}</span>
                  <span className="text-sm font-black uppercase tracking-[0.16em]">{stat.unit}</span>
                </div>
                <HugeiconsIcon icon={stat.icon} size={30} strokeWidth={2.2} />
              </div>
              <div className="mt-3 text-[11px] font-bold uppercase leading-relaxed tracking-[0.12em]">{stat.label}</div>
            </div>
          ))}
        </section>
        </Reveal>

        {/* --------------- HOW IT WORKS --------------- */}
        <section id="how" className="scroll-mt-20 py-16">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <h2 className="text-4xl font-black uppercase leading-none tracking-[-0.05em] sm:text-5xl">
              How a drill
              <br />
              works
            </h2>
            <span className="brutal-sticker bg-paper-light rotate-1">
              <HugeiconsIcon icon={Timer02Icon} size={14} strokeWidth={2.6} />
              About 8 minutes a run
            </span>
          </div>

          <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, index) => (
              <li key={step.n} className="[perspective:900px]">
                <Reveal delay={index * 90}>
                  <Tilt className="brutal-card tilt-shadow flex h-full flex-col p-6">
                    <div className="tilt-raise flex items-center justify-between">
                      <span className="brutal-num font-mono text-5xl font-black leading-none">{step.n}</span>
                      <span className="grid h-11 w-11 place-items-center border-[3px] border-ink bg-sun shadow-[3px_3px_0_var(--ink)]">
                        <HugeiconsIcon icon={step.icon} size={22} strokeWidth={2.3} />
                      </span>
                    </div>
                    <h3 className="mt-4 text-base font-black uppercase tracking-wide">{step.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-ink-soft">{step.body}</p>
                  </Tilt>
                </Reveal>
              </li>
            ))}
          </ol>
        </section>

        {/* --------------- ROLES --------------- */}
        <section id="roles" className="scroll-mt-20 grid gap-8 pb-16 lg:grid-cols-2 [perspective:1100px]">
          <Reveal>
          <Tilt className="brutal-slab tilt-shadow-violet h-full bg-paper-light p-7" max={5}>
            <div className="flex items-start justify-between gap-4">
              <span className="brutal-sticker bg-violet text-paper -rotate-2">Role 01</span>
              <HugeiconsIcon icon={WorkoutRunIcon} size={44} strokeWidth={2} className="text-violet" />
            </div>
            <h3 className="mt-5 text-4xl font-black uppercase leading-none tracking-[-0.05em]">The evacuee</h3>
            <p className="mt-4 text-sm leading-relaxed text-ink-soft">
              You are inside the building. You read the signs, pick up equipment, shut the gas valve and find the marked
              exit — but the hazards are invisible to you. You have to trust what you are told.
            </p>
            <ul className="mt-6 grid gap-2.5 text-[12px] font-black uppercase tracking-wide">
              <li className="flex items-center gap-2.5 border-l-[5px] border-violet pl-3">
                <HugeiconsIcon icon={KeyboardIcon} size={17} strokeWidth={2.4} className="shrink-0 text-violet" />
                WASD move / Space jump / E interact
              </li>
              <li className="flex items-center gap-2.5 border-l-[5px] border-violet pl-3">
                <HugeiconsIcon icon={Mouse01Icon} size={17} strokeWidth={2.4} className="shrink-0 text-violet" />
                V switches camera / Esc opens the menu
              </li>
            </ul>
          </Tilt>
          </Reveal>

          <Reveal delay={120}>
          <Tilt className="brutal-slab tilt-shadow-coral h-full bg-night p-7 text-paper" max={5}>
            <div className="flex items-start justify-between gap-4">
              <span className="brutal-sticker border-paper bg-coral text-ink rotate-2">Role 02</span>
              <HugeiconsIcon icon={CctvCameraIcon} size={44} strokeWidth={2} className="text-coral" />
            </div>
            <h3 className="mt-5 text-4xl font-black uppercase leading-none tracking-[-0.05em]">The warden</h3>
            <p className="mt-4 text-sm leading-relaxed text-paper/75">
              You watch from above. You can see the gas leak and the east route failing. Verify the evidence, send one
              clear route message, and spend your single ventilation override at the right moment.
            </p>
            <ul className="mt-6 grid gap-2.5 text-[12px] font-black uppercase tracking-wide">
              <li className="flex items-center gap-2.5 border-l-[5px] border-coral pl-3">
                <HugeiconsIcon icon={Search01Icon} size={17} strokeWidth={2.4} className="shrink-0 text-coral" />
                <span className="flex flex-wrap items-center gap-1.5">
                  Observe
                  <HugeiconsIcon icon={ArrowRight02Icon} size={13} strokeWidth={2.8} />
                  verify
                  <HugeiconsIcon icon={ArrowRight02Icon} size={13} strokeWidth={2.8} />
                  send route
                </span>
              </li>
              <li className="flex items-center gap-2.5 border-l-[5px] border-coral pl-3">
                <HugeiconsIcon icon={FlashIcon} size={17} strokeWidth={2.4} className="shrink-0 text-coral" />
                One intervention per drill
              </li>
            </ul>
          </Tilt>
          </Reveal>
        </section>

        {/* --------------- OBJECTIVES --------------- */}
        <section id="objectives" className="scroll-mt-20 border-t-[3px] border-ink py-16">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 className="text-4xl font-black uppercase leading-none tracking-[-0.05em] sm:text-5xl">
              What you&apos;ll
              <br />
              practise
            </h2>
            <p className="max-w-sm text-sm leading-relaxed text-ink-soft">
              Six objectives across two blocks, then the marked exit. The HUD always shows the next one.
            </p>
          </div>

          <Reveal><ul className="stagger mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {OBJECTIVES.map((objective, index) => (
              <li key={objective.label} className="flex items-center gap-3 border-[3px] border-ink bg-paper-light px-4 py-3.5 shadow-[5px_5px_0_var(--ink)] transition duration-300 hover:-translate-y-1 hover:shadow-[8px_8px_0_var(--ink)]">
                <span className={`grid h-11 w-11 shrink-0 place-items-center border-[3px] border-ink ${objective.color}`}>
                  <HugeiconsIcon icon={objective.icon} size={22} strokeWidth={2.3} />
                </span>
                <span>
                  <span className="block font-mono text-[10px] font-black tracking-[0.2em] text-ink-soft">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="block text-[12px] font-black uppercase tracking-wide">{objective.label}</span>
                  <span className="block text-[11px] text-ink-soft">{objective.place}</span>
                </span>
              </li>
            ))}
          </ul></Reveal>
        </section>

        {/* --------------- AWS --------------- */}
        <section className="pb-16">
          <Reveal>
          <div className="brutal-slab grid gap-8 bg-night p-8 text-paper shadow-[10px_10px_0_var(--sun)] lg:grid-cols-[0.75fr_1.25fr] lg:items-center">
            <div>
              <span className="brutal-sticker border-paper bg-sun text-ink -rotate-2">Built on AWS</span>
              <h2 className="mt-5 text-4xl font-black uppercase leading-[0.9] tracking-[-0.05em]">
                No game
                <br />
                server.
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-paper/70">
                The two browsers share the game logic between them. Validation and storage run inside AWS&apos;s managed
                services, so there is nothing to keep alive between drills.
              </p>
            </div>
            <ul className="grid gap-4 sm:grid-cols-3">
              {STACK.map((item) => (
                <li key={item.name} className="border-[3px] border-paper/25 p-5">
                  <HugeiconsIcon icon={item.icon} size={28} strokeWidth={2.2} className="text-sun" />
                  <span className="mt-3 block text-sm font-black uppercase tracking-wide text-sun">{item.name}</span>
                  <span className="mt-2.5 block text-[12px] leading-relaxed text-paper/70">{item.body}</span>
                </li>
              ))}
            </ul>
          </div>
          </Reveal>
        </section>

        {/* --------------- CTA --------------- */}
        <section className="relative border-t-[3px] border-ink py-16">
          <Reveal>
          <div className="flex flex-col items-start justify-between gap-8 sm:flex-row sm:items-center">
            <h2 className="text-5xl font-black uppercase leading-[0.85] tracking-[-0.055em] sm:text-6xl">
              Grab a partner.
              <br />
              <span className="text-coral">Find the exit.</span>
            </h2>
            <div className="flex flex-wrap items-center gap-4">
              <Image
                src={mascotImg}
                alt=""
                width={104}
                height={140}
                className="hidden rotate-[5deg] drop-shadow-[5px_5px_0_rgba(29,22,38,0.2)] sm:block"
              />
              <Link href="/simulation/rooms" className="brutal-button gap-2.5 border-[3px] px-7 py-4 text-[12px] shadow-[6px_6px_0_var(--ink)]">
                Start a drill
                <HugeiconsIcon icon={ArrowRight02Icon} size={19} strokeWidth={2.6} />
              </Link>
              <Link href="/simulation/play" className="inline-flex items-center gap-2.5 border-[3px] border-ink bg-paper-light px-7 py-4 text-[12px] font-black uppercase tracking-[0.16em] shadow-[6px_6px_0_var(--ink)] hover:bg-ink hover:text-paper">
                <HugeiconsIcon icon={WorkoutRunIcon} size={19} strokeWidth={2.6} />
                Practice solo
              </Link>
            </div>
          </div>
          </Reveal>
        </section>
      </div>

      {/* --------------- FOOTER --------------- */}
      <footer className="border-t-[3px] border-ink bg-ink">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-3 px-5 py-5 text-[10px] font-black uppercase tracking-[0.14em] text-paper/70 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span>CampusEvac / Bharat Builds Tour / AWS &times; WeMakeDevs</span>
          <span className="flex items-center gap-2 text-sun">
            <HugeiconsIcon icon={AlarmSmokeIcon} size={14} strokeWidth={2.6} />
            A training simulation, not live emergency guidance.
          </span>
        </div>
      </footer>
    </main>
  );
}
