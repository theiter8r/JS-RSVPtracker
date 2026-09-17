/**
 * Loads local secrets for the CLI scripts. `.env.local` wins over `.env`, matching
 * Next.js's own precedence so the site and the scripts read identical values.
 */
import { config } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

for (const file of [".env.local", ".env"]) {
  const path = resolve(process.cwd(), file);
  if (existsSync(path)) config({ path, override: false, quiet: true });
}

export function arg(name: string): string | undefined {
  const flag = `--${name}`;
  const i = process.argv.indexOf(flag);
  if (i !== -1) return process.argv[i + 1]?.startsWith("--") ? "" : process.argv[i + 1];
  const inline = process.argv.find((a) => a.startsWith(`${flag}=`));
  return inline ? inline.slice(flag.length + 1) : undefined;
}

export function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

export const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};

export async function confirm(question: string): Promise<boolean> {
  const readline = await import("node:readline/promises");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${question} (yes/no) `)).trim().toLowerCase();
  rl.close();
  return answer === "yes" || answer === "y";
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
