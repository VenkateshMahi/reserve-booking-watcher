import { describe, expect, it } from "vitest";
import { formatTelegramMessage } from "../src/notifier/telegram.js";
import { AvailabilityStatus, type TheatreAvailability } from "../src/types.js";

describe("formatTelegramMessage", () => {
  it("formats the booking alert with theatre, shows, and URL", () => {
    const availability: TheatreAvailability = {
      provider: "bookmyshow",
      movie: "Jana Nayagan",
      city: "Chennai",
      theatre: "PVR Palazzo",
      status: AvailabilityStatus.Available,
      shows: [{ startTime: "4:00 AM" }, { startTime: "7:30 AM" }],
      bookingUrl: "https://tickets.example/book",
      checkedAt: "2026-07-19T00:00:00.000Z"
    };

    const message = formatTelegramMessage(availability, "2026-07-19T00:01:00.000Z");
    const lines = message.split("\n");

    expect(lines[0]).toBe("🚨 PVR Palazzo");
    expect(lines[1]).toBe("🎬 Jana Nayagan - BOOKINGS OPEN");
    expect(message).toContain("4:00 AM\n7:30 AM");
    expect(message).toContain("https://tickets.example/book");
  });
});
