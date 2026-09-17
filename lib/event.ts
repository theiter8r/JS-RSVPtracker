/**
 * Single source of truth for event details. Used by both the landing page and
 * the email template so the two can never drift apart.
 */
export const EVENT = {
  name: "JS Mumbai #3",
  lumaId: "evt-QHXOdahGbvATs1P",
  lumaUrl: "https://luma.com/jolbsr2c",

  /** Start/end in IST. */
  dateLabel: "Saturday, 26 September 2026",
  timeLabel: "10:00 AM – 3:00 PM IST",
  startsAt: new Date("2026-09-26T04:30:00.000Z"),
  endsAt: new Date("2026-09-26T09:30:00.000Z"),

  venueName: "Waterstones Hotel",
  venueAddress: "Marol, Andheri East, Mumbai, Maharashtra 400059",
  mapsUrl:
    "https://www.google.com/maps/search/?api=1&query=Waterstones+Hotel+Marol+Andheri+East+Mumbai",
} as const;

export const RESPONSE_WINDOW_HOURS = 48;
