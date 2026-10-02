"use client";

import { useEffect } from "react";
import DrillShell from "../DrillShell";
import { useSimulation } from "../store";

export default function PlayPage() {
  useEffect(() => {
    const g = useSimulation.getState();
    g.setMode({ kind: "solo" });
    g.reset();
  }, []);

  return (
    <main className="relative flex-1">
      <DrillShell title="Solo sandbox" />
    </main>
  );
}
