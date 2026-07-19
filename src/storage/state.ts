import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  AvailabilityStatus,
  NotificationMode,
  createAvailabilityKey,
  type StoredNotificationState,
  type StoredState,
  type TheatreAvailability
} from "../types.js";

export class JsonStateStore {
  private state: StoredState | undefined;

  constructor(private readonly filePath: string) {}

  async load(): Promise<StoredState> {
    if (this.state) {
      return this.state;
    }

    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as StoredState;
      this.state = parsed;
      return parsed;
    } catch (error) {
      const maybeNodeError = error as NodeJS.ErrnoException;
      if (maybeNodeError.code !== "ENOENT") {
        throw error;
      }

      this.state = {
        version: 1,
        updatedAt: new Date().toISOString(),
        notifications: {}
      };
      return this.state;
    }
  }

  async shouldNotify(
    availability: TheatreAvailability,
    options: { notificationMode?: NotificationMode } = {}
  ): Promise<boolean> {
    if (
      options.notificationMode === NotificationMode.WhileAvailable &&
      availability.status === AvailabilityStatus.Available
    ) {
      return true;
    }

    const state = await this.load();
    const key = createAvailabilityKey(availability);
    const previous = state.notifications[key];
    return (
      availability.status === AvailabilityStatus.Available &&
      (previous?.status !== AvailabilityStatus.Available || !previous.notifiedAt)
    );
  }

  async saveObservation(
    availability: TheatreAvailability,
    notifiedAt?: string
  ): Promise<StoredNotificationState> {
    const state = await this.load();
    const key = createAvailabilityKey(availability);
    const previous = state.notifications[key];
    const shows =
      availability.status === AvailabilityStatus.Available
        ? availability.shows.map((show) => show.startTime).sort()
        : [];
    const next: StoredNotificationState = {
      key,
      provider: availability.provider,
      movie: availability.movie,
      city: availability.city,
      theatre: availability.theatre,
      status: availability.status,
      showHash: shows.join("|"),
      shows,
      lastCheckedAt: availability.checkedAt
    };

    if (availability.theatreId) {
      next.theatreId = availability.theatreId;
    }
    if (availability.theatreChain) {
      next.theatreChain = availability.theatreChain;
    }
    if (availability.theatrePriority !== undefined) {
      next.theatrePriority = availability.theatrePriority;
    }

    const nextNotifiedAt = notifiedAt ?? previous?.notifiedAt;
    if (nextNotifiedAt) {
      next.notifiedAt = nextNotifiedAt;
    }

    if (availability.bookingUrl) {
      next.bookingUrl = availability.bookingUrl;
    } else if (previous?.bookingUrl) {
      next.bookingUrl = previous.bookingUrl;
    }

    state.notifications[key] = next;
    state.updatedAt = new Date().toISOString();
    return next;
  }

  async save(): Promise<void> {
    const state = await this.load();
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(tempPath, this.filePath);
  }
}
