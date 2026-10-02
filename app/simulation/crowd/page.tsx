"use client";

import { useEffect } from "react";
import { useSimulation } from "../store";
import CrowdLab, { usePauseWhenHidden } from "./CrowdLab";

export default function CrowdPage() {
  usePauseWhenHidden();
  useEffect(() => {
    // the overhead look: walls cut to knee height, no ceilings, wall decor hidden
    const g = useSimulation.getState();
    g.setMode({ kind: "warden", sectorId: "lobby" });
    return () => useSimulation.getState().setMode({ kind: "solo" });
  }, []);

  return (
    <main className="relative flex-1">
      <CrowdLab />
    </main>
  );
}
