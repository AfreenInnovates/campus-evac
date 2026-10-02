"use client";

type BriefingArtworkProps = { slide: number };

const blue = "#55c7ff";
const mint = "#71f0c0";
const yellow = "#ffd45c";
const red = "#ff6b72";

function Logo() {
  return (
    <svg viewBox="0 0 520 240" className="h-full w-full" role="img" aria-label="CampusEvac logo">
      <rect width="520" height="240" rx="22" fill="#10151d" />
      <path d="M74 156V88l92-43 92 43v68" fill="none" stroke={blue} strokeWidth="9" strokeLinejoin="round" />
      <path d="M106 156v-39h120v39M150 156v-48h32v48" fill="none" stroke={mint} strokeWidth="8" />
      <path d="m166 45 20 27-20 25-20-25z" fill="none" stroke={yellow} strokeWidth="7" />
      <text x="284" y="116" fill="#f7fafc" fontFamily="system-ui, sans-serif" fontSize="44" fontWeight="800">Campus</text>
      <text x="284" y="158" fill={red} fontFamily="system-ui, sans-serif" fontSize="44" fontWeight="800">Evac</text>
      <text x="284" y="187" fill="#8b99a9" fontFamily="monospace" fontSize="12" letterSpacing="3">CONTROLLED DRILL SYSTEM</text>
    </svg>
  );
}

function MapCard() {
  return (
    <svg viewBox="0 0 520 240" className="h-full w-full" role="img" aria-label="Campus route map">
      <rect width="520" height="240" rx="22" fill="#10151d" />
      <path d="M70 183h380M70 58h380M70 58v125M450 58v125" stroke="#283746" strokeWidth="3" />
      <rect x="82" y="76" width="116" height="84" rx="5" fill="#182a38" stroke={blue} strokeWidth="3" />
      <rect x="322" y="76" width="116" height="84" rx="5" fill="#2a2634" stroke={yellow} strokeWidth="3" />
      <rect x="214" y="96" width="92" height="44" rx="5" fill="#20352f" stroke={mint} strokeWidth="3" />
      <path d="M260 204V143M198 118h16M306 118h16" stroke={mint} strokeWidth="5" strokeDasharray="8 7" />
      <circle cx="260" cy="204" r="8" fill={blue} />
      <circle cx="102" cy="99" r="8" fill={red} />
      <circle cx="417" cy="98" r="8" fill={yellow} />
      <text x="96" y="132" fill="#d9f2ff" fontFamily="monospace" fontSize="13" fontWeight="700">SCIENCE</text>
      <text x="340" y="132" fill="#fff1b2" fontFamily="monospace" fontSize="13" fontWeight="700">ACADEMIC</text>
      <text x="233" y="121" fill="#bbffe3" fontFamily="monospace" fontSize="11" fontWeight="700">FOYER</text>
      <text x="221" y="221" fill="#8b99a9" fontFamily="monospace" fontSize="11" letterSpacing="2">START / MARKED EXIT</text>
    </svg>
  );
}

function KitCard() {
  return (
    <svg viewBox="0 0 520 240" className="h-full w-full" role="img" aria-label="Mission equipment diagram">
      <rect width="520" height="240" rx="22" fill="#10151d" />
      <g transform="translate(54 58)">
        <rect width="112" height="112" rx="14" fill="#182a38" stroke={blue} strokeWidth="3" />
        <rect x="22" y="24" width="68" height="64" rx="8" fill="#1e2e3b" stroke={blue} strokeWidth="3" />
        <path d="M38 24c0-16 36-16 36 0M42 58h28M56 44v28" stroke={mint} strokeWidth="6" strokeLinecap="round" />
        <text x="10" y="139" fill="#bdeaff" fontFamily="monospace" fontSize="11">BACKPACK</text>
      </g>
      <g transform="translate(204 64)">
        <rect width="98" height="62" rx="6" fill="#f7cc4b" transform="rotate(-8 49 31)" />
        <rect x="22" y="19" width="54" height="7" rx="3" fill="#5f501e" transform="rotate(-8 49 31)" />
        <circle cx="80" cy="45" r="8" fill={red} />
        <text x="3" y="105" fill="#fff1b2" fontFamily="monospace" fontSize="11">ACCESS CARD</text>
      </g>
      <g transform="translate(362 58)">
        <circle cx="54" cy="55" r="40" fill="#202a31" stroke={red} strokeWidth="7" />
        <path d="M54 15v80M14 55h80" stroke="#d9e2e7" strokeWidth="7" />
        <circle cx="54" cy="55" r="9" fill={red} />
        <text x="13" y="139" fill="#ffb2b7" fontFamily="monospace" fontSize="11">ISOLATE GAS</text>
      </g>
      <text x="55" y="205" fill="#8b99a9" fontFamily="monospace" fontSize="11" letterSpacing="2">COLLECT  /  DECODE  /  CONTROL</text>
    </svg>
  );
}

function RouteCard() {
  return (
    <svg viewBox="0 0 520 240" className="h-full w-full" role="img" aria-label="Safe route and information boundary">
      <rect width="520" height="240" rx="22" fill="#10151d" />
      <path d="M76 164c55-4 63-88 122-88 50 0 52 82 106 82 50 0 46-54 140-75" fill="none" stroke={mint} strokeWidth="8" strokeLinecap="round" />
      <path d="M76 164c55-4 63-88 122-88 50 0 52 82 106 82 50 0 46-54 140-75" fill="none" stroke="#d8fff0" strokeWidth="2" strokeDasharray="5 9" />
      <path d="m423 72 24 1-14 20" fill="none" stroke={mint} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="76" cy="164" r="10" fill={blue} />
      <circle cx="444" cy="70" r="10" fill={mint} />
      <path d="M129 53h66M129 53l-13 11M195 53l13 11" stroke={yellow} strokeWidth="5" />
      <text x="110" y="40" fill="#fff1b2" fontFamily="monospace" fontSize="11">WARDEN SEES THREATS</text>
      <text x="62" y="203" fill="#bdeaff" fontFamily="monospace" fontSize="11" letterSpacing="1">YOU SEE SIGNS  /  THEY VERIFY RISK</text>
    </svg>
  );
}

export default function BriefingArtwork({ slide }: BriefingArtworkProps) {
  return (
    <div className="relative h-40 overflow-hidden rounded-xl border border-white/10 bg-[#10151d] shadow-[0_18px_45px_rgba(0,0,0,0.35)] sm:h-48">
      <div className="absolute inset-0 opacity-20" style={{ backgroundImage: "linear-gradient(rgba(85,199,255,.18) 1px, transparent 1px), linear-gradient(90deg, rgba(85,199,255,.18) 1px, transparent 1px)", backgroundSize: "24px 24px" }} />
      <div className="relative h-full p-3 sm:p-5">
        {slide === 0 && <Logo />}
        {slide === 1 && <MapCard />}
        {slide === 2 && <KitCard />}
        {slide >= 3 && <RouteCard />}
      </div>
    </div>
  );
}
