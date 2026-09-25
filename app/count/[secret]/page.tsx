import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { query } from "@/lib/db";
import { env } from "@/lib/env";
import { EVENT } from "@/lib/event";
import Led from "./led";
import "./count.css";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ secret: string }>;
}): Promise<Metadata> {
  const { secret } = await params;
  return {
    title: `${EVENT.name} — live count`,
    robots: { index: false, follow: false },
    // Scoped to the secret so the manifest never publishes it. See the route.
    manifest: `/count/${secret}/site.webmanifest`,
    // Lets iOS run it chromeless once it's added to the Home Screen, which is the
    // only way an iPhone ever fills the screen — it has no Fullscreen API.
    appleWebApp: { capable: true, statusBarStyle: "black-translucent" },
    other: { "mobile-web-app-capable": "yes" },
  };
}

export const viewport = {
  themeColor: "#000000",
  viewportFit: "cover" as const,
};

/**
 * The live headcount, shown on whatever screen you point at the room.
 *
 * Secret-gated rather than password-protected: a display device should never
 * need someone to type credentials into it.
 */
export default async function CountPage({
  params,
}: {
  params: Promise<{ secret: string }>;
}) {
  const { secret } = await params;
  if (secret !== env.countSecret) notFound();

  // Server-rendered so the number is correct on the very first paint, with no
  // flash of zero while the first poll is in flight.
  const [row] = await query<{ count: string }>(
    `SELECT count(*) AS count FROM attendees WHERE checked_in_at IS NOT NULL`,
  );

  return <Led initial={Number(row?.count ?? 0)} secret={secret} />;
}
