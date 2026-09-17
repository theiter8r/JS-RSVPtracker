import { Pool } from "pg";
import { env } from "./env";

/**
 * A single pg Pool per process. Next.js dev reloads modules on every edit, so the
 * pool is stashed on globalThis to avoid leaking connections across hot reloads.
 */
const globalForDb = globalThis as unknown as { __rsvpPool?: Pool };

export const pool: Pool =
  globalForDb.__rsvpPool ??
  new Pool({
    connectionString: env.databaseUrl,
    // Neon and most hosted Postgres require TLS but present a cert chain Node
    // doesn't ship a root for; the connection is still encrypted.
    ssl: env.databaseUrl.includes("localhost") ? false : { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30_000,
  });

if (process.env.NODE_ENV !== "production") globalForDb.__rsvpPool = pool;

export async function query<T extends Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await pool.query(text, params as never[]);
  return result.rows as T[];
}

export type ParticipantStatus = "pending" | "yes" | "no";

export type Participant = {
  id: number;
  email: string;
  name: string | null;
  luma_api_id: string | null;
  registered_at: Date | null;
  token: string;
  status: ParticipantStatus;
  responded_at: Date | null;
  token_expires_at: Date;
  created_at: Date;
};
