"use client";

import { Bloom, EffectComposer, SMAA, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { useSimulation } from "../store";

/**
 * The cinematic pass, kept deliberately small: a glow on anything brighter than white
 * (light panels, exit signs, the sunset), a soft vignette, filmic tone mapping and a cheap
 * edge smoothing in place of multisampling. Desktop only, switchable from the pause menu,
 * and dropped automatically when the frame rate cannot keep up.
 */
export default function Effects() {
  const evacueeView = useSimulation((s) => s.view === "evacuee");
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <Bloom mipmapBlur luminanceThreshold={0.92} luminanceSmoothing={0.2} intensity={0.7} radius={0.6} levels={5} />
      <Vignette offset={0.28} darkness={evacueeView ? 0.6 : 0.35} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <SMAA />
    </EffectComposer>
  );
}
