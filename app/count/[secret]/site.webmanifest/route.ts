import { env } from "@/lib/env";
import { EVENT } from "@/lib/event";

export const dynamic = "force-dynamic";

/**
 * The install manifest for the count display.
 *
 * Deliberately served from behind the secret rather than from the app root. A
 * root manifest would have to publish `start_url: /count/<secret>` to be useful,
 * and anyone could then read the secret straight out of /manifest.webmanifest —
 * which is the whole thing it exists to protect.
 *
 * `display: standalone` is the point of the file: it's the only way an iPhone
 * ever shows this full screen, since iOS Safari has no Fullscreen API.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ secret: string }> }) {
  const { secret } = await ctx.params;
  if (secret !== env.countSecret) return new Response("Not found", { status: 404 });

  return Response.json(
    {
      name: `${EVENT.name} — live count`,
      short_name: "Live count",
      description: `Checked-in headcount for ${EVENT.name}.`,
      start_url: `/count/${secret}`,
      scope: `/count/${secret}`,
      display: "standalone",
      orientation: "landscape",
      background_color: "#000000",
      theme_color: "#000000",
      icons: [],
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
