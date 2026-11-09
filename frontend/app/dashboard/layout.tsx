import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Investigation Console",
  description: "Review incident timelines, evidence, investigation tasks, and traceable reports.",
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
