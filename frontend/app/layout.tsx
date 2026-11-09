import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    default: "VOXSHIELD — Investigate Smarter. Respond with Clarity.",
    template: "%s | VOXSHIELD",
  },
  description: "An AI-powered investigation workspace that transforms incident updates into structured timelines, traceable evidence, actionable tasks, and comprehensive reports.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
