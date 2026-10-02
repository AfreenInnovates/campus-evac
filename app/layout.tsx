import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CampusEvac: Two views. One safe exit.",
  description:
    "A two-player evacuation drill in the browser. The evacuee moves through the campus; the warden sees the hazards and talks them out.",
};

/**
 * The run is played on a phone as often as a laptop. `viewportFit: cover` lets
 * the canvas fill past the notch, and the interactive-widget setting keeps the
 * on-screen controls where the thumbs left them when a keyboard opens.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#16111e",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex h-full min-h-0 flex-col overflow-hidden overscroll-none">
        {children}
      </body>
    </html>
  );
}
