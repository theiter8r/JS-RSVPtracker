import type { Metadata } from "next";
import { EVENT } from "@/lib/event";
import Scanner from "./scanner";
import "./scan.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `${EVENT.name} — door`,
  robots: { index: false, follow: false },
};

/**
 * The door. Behind HTTP Basic auth via `proxy.ts`, so a volunteer signs in once
 * on their own phone and stays signed in for the session.
 */
export default function ScanPage() {
  return <Scanner />;
}
