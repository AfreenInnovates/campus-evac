import type { MetadataRoute } from "next";

/**
 * Installed to a home screen, the drill opens fullscreen and sideways - the only way a
 * browser will hold a phone in landscape without a tap first.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CampusEvac",
    short_name: "CampusEvac",
    description: "A two-player fire evacuation drill in the browser.",
    start_url: "/",
    display: "fullscreen",
    orientation: "landscape",
    background_color: "#16111e",
    theme_color: "#16111e",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
