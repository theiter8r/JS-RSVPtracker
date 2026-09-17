/**
 * Nudges everyone who was invited but hasn't answered yet.
 *
 *   npx tsx scripts/send-reminders.ts --dry-run
 *   npx tsx scripts/send-reminders.ts --limit 400
 *
 * A thin wrapper over send-wave.ts with --kind reminder, so the throttling,
 * resumability and abort logic stay in exactly one place.
 */
if (!process.argv.includes("--kind")) process.argv.push("--kind", "reminder");

// Not a top-level await: tsx compiles these scripts as CJS, where that isn't allowed.
void import("./send-wave");

export {};
