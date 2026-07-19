import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { JsonStateStore } from "../src/storage/state.js";
import { AvailabilityStatus, NotificationMode, type TheatreAvailability } from "../src/types.js";

function availability(status: AvailabilityStatus): TheatreAvailability {
  return {
    provider: "bookmyshow",
    movie: "Jana Nayagan",
    city: "Chennai",
    theatre: "PVR Palazzo",
    status,
    shows: [{ startTime: "4:00 AM" }],
    checkedAt: "2026-07-19T00:00:00.000Z"
  };
}

describe("JsonStateStore", () => {
  it("notifies only after an available state has been delivered", async () => {
    const dir = await mkdtemp(join(tmpdir(), "movie-watcher-"));
    const store = new JsonStateStore(join(dir, "state.json"));
    const open = availability(AvailabilityStatus.Available);

    expect(await store.shouldNotify(open)).toBe(true);

    await store.saveObservation(open);
    expect(await store.shouldNotify(open)).toBe(true);

    await store.saveObservation(open, "2026-07-19T00:01:00.000Z");
    expect(await store.shouldNotify(open)).toBe(false);
  });

  it("notifies again after state returns to not available and then available", async () => {
    const dir = await mkdtemp(join(tmpdir(), "movie-watcher-"));
    const store = new JsonStateStore(join(dir, "state.json"));

    await store.saveObservation(availability(AvailabilityStatus.Available), "2026-07-19T00:01:00.000Z");
    expect(await store.shouldNotify(availability(AvailabilityStatus.Available))).toBe(false);

    await store.saveObservation(availability(AvailabilityStatus.NotAvailable));
    expect(await store.shouldNotify(availability(AvailabilityStatus.Available))).toBe(true);
  });

  it("notifies on every available observation in while-available mode", async () => {
    const dir = await mkdtemp(join(tmpdir(), "movie-watcher-"));
    const store = new JsonStateStore(join(dir, "state.json"));
    const open = availability(AvailabilityStatus.Available);

    await store.saveObservation(open, "2026-07-19T00:01:00.000Z");

    expect(
      await store.shouldNotify(open, {
        notificationMode: NotificationMode.WhileAvailable
      })
    ).toBe(true);
    expect(
      await store.shouldNotify(availability(AvailabilityStatus.NotAvailable), {
        notificationMode: NotificationMode.WhileAvailable
      })
    ).toBe(false);
  });
});
