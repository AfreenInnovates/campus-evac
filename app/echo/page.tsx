import type { Metadata } from "next";
import EchoClient from "./EchoClient";

export const metadata: Metadata = {
  title: "CampusEvac on Echo",
  description: "A simulated Alexa+ device: ask the way out, or run a what-if fire drill by voice.",
};

export default function EchoPage() {
  return <EchoClient />;
}
