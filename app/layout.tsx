import type { Metadata } from "next";
import "./globals.css";
import { EVENT } from "@/lib/event";

export const metadata: Metadata = {
  title: `${EVENT.name} — Confirm your seat`,
  description: `Let us know whether you're coming to ${EVENT.name}.`,
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
