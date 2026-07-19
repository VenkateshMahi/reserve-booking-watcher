import {
  AvailabilityStatus,
  ShowAvailabilityStatus,
  type Showtime,
  type TheatreAvailability
} from "../types.js";
import type { AvailabilityExtractionInput } from "./availabilityExtractor.js";
import { normalizeShowAvailabilityStatus } from "./availabilityExtractor.js";
import { matchesConfiguredTheatre, normalizeText } from "../utils/text.js";

interface DistrictCinemaRecord {
  cinemaInfo?: {
    name?: unknown;
    label?: unknown;
    chainKey?: unknown;
  };
  sessions?: unknown;
}

interface DistrictSessionRecord {
  showTime?: unknown;
  seatStatus?: unknown;
  statusColor?: unknown;
  seatClass?: unknown;
  disableClick?: unknown;
  avail?: unknown;
  areas?: unknown;
  audi?: unknown;
  scrnFmt?: unknown;
}

const bookableStatuses = new Set<ShowAvailabilityStatus>([
  ShowAvailabilityStatus.Available,
  ShowAvailabilityStatus.FastFilling,
  ShowAvailabilityStatus.AlmostFull
]);

export function extractDistrictAvailabilityFromJson(
  payload: unknown,
  input: AvailabilityExtractionInput
): TheatreAvailability[] {
  const records: TheatreAvailability[] = [];

  walkObjects(payload, (object, path) => {
    if (!isDistrictCinemaRecord(object)) {
      return;
    }

    const theatre = theatreName(object);
    if (!theatre || !matchesConfiguredTheatre(theatre, input.theatres)) {
      return;
    }

    const rawSessions = Array.isArray(object.sessions) ? object.sessions : [];
    const shows = rawSessions
      .filter(isDistrictSessionRecord)
      .map((session) => toShowtime(session))
      .filter((show): show is Showtime => show !== undefined);
    const bookableShows = shows.filter(
      (show) => show.status && bookableStatuses.has(show.status)
    );
    const status =
      bookableShows.length > 0
        ? AvailabilityStatus.Available
        : rawSessions.length > 0
          ? AvailabilityStatus.NotAvailable
          : AvailabilityStatus.Unknown;

    const availability: TheatreAvailability = {
      provider: input.provider,
      movie: input.movie,
      city: input.city,
      theatre,
      status,
      shows: bookableShows,
      checkedAt: input.checkedAt,
      diagnostics: {
        extractedFrom: path,
        source: input.sourceUrl,
        rawShowCount: rawSessions.length,
        bookableShowCount: bookableShows.length
      }
    };

    if (input.sourceUrl) {
      availability.bookingUrl = input.sourceUrl;
      availability.sourceUrl = input.sourceUrl;
    }
    if (typeof object.cinemaInfo?.chainKey === "string" && object.cinemaInfo.chainKey.trim()) {
      availability.theatreChain = object.cinemaInfo.chainKey.trim();
    }

    records.push(availability);
  });

  return mergeDistrictAvailabilities(records);
}

function isDistrictCinemaRecord(value: unknown): value is DistrictCinemaRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const maybeRecord = value as DistrictCinemaRecord;
  return Boolean(maybeRecord.cinemaInfo) && Array.isArray(maybeRecord.sessions);
}

function isDistrictSessionRecord(value: unknown): value is DistrictSessionRecord {
  return Boolean(value && typeof value === "object" && "showTime" in value);
}

function theatreName(cinema: DistrictCinemaRecord): string | undefined {
  const name = cinema.cinemaInfo?.name ?? cinema.cinemaInfo?.label;
  return typeof name === "string" && name.trim() ? name.trim() : undefined;
}

function toShowtime(session: DistrictSessionRecord): Showtime | undefined {
  const startTime = formatDistrictShowTime(session.showTime);
  if (!startTime) {
    return undefined;
  }

  const status = inferDistrictSessionStatus(session);
  const showtime: Showtime = {
    startTime,
    status: status.status,
    rawStatus: status.rawStatus,
    raw: {
      showTime: session.showTime,
      seatStatus: session.seatStatus,
      statusColor: session.statusColor,
      seatClass: session.seatClass,
      disableClick: session.disableClick,
      avail: session.avail,
      audi: session.audi,
      scrnFmt: session.scrnFmt
    }
  };

  const labelParts = [startTime];
  if (typeof session.scrnFmt === "string" && session.scrnFmt.trim()) {
    showtime.format = session.scrnFmt.trim();
    labelParts.push(session.scrnFmt.trim());
  }
  if (typeof session.audi === "string" && session.audi.trim()) {
    showtime.screen = session.audi.trim();
    labelParts.push(session.audi.trim());
  }
  showtime.label = labelParts.join(" - ");

  return showtime;
}

function inferDistrictSessionStatus(session: DistrictSessionRecord): {
  status: ShowAvailabilityStatus;
  rawStatus: string;
} {
  if (!isDistrictSessionBookable(session)) {
    return { status: ShowAvailabilityStatus.SoldOut, rawStatus: "Sold Out" };
  }

  const rawStatus = typeof session.seatStatus === "string" ? session.seatStatus : "";
  const normalizedStatus = rawStatus
    ? normalizeShowAvailabilityStatus(rawStatus)
    : undefined;

  return {
    status: normalizedStatus ?? ShowAvailabilityStatus.Available,
    rawStatus: rawStatus || "Available"
  };
}

function isDistrictSessionBookable(session: DistrictSessionRecord): boolean {
  if (session.disableClick === true) {
    return false;
  }

  if (
    typeof session.seatClass === "string" &&
    normalizeText(session.seatClass).includes("grey")
  ) {
    return false;
  }

  if (typeof session.avail === "number") {
    return session.avail > 0;
  }

  const areaAvailability = areaAvailableSeats(session.areas);
  if (areaAvailability !== undefined) {
    return areaAvailability > 0;
  }

  if (typeof session.statusColor === "string" && session.statusColor.trim().toUpperCase() === "D") {
    return false;
  }

  const rawStatus = typeof session.seatStatus === "string" ? session.seatStatus : "";
  const normalizedStatus = rawStatus
    ? normalizeShowAvailabilityStatus(rawStatus)
    : undefined;
  return Boolean(normalizedStatus && bookableStatuses.has(normalizedStatus));
}

function areaAvailableSeats(areas: unknown): number | undefined {
  if (!Array.isArray(areas)) {
    return undefined;
  }

  let total = 0;
  let sawAvailability = false;
  for (const area of areas) {
    if (!area || typeof area !== "object") {
      continue;
    }

    const value = (area as { sAvail?: unknown; seatsAvail?: unknown }).sAvail ??
      (area as { seatsAvail?: unknown }).seatsAvail;
    if (typeof value === "number") {
      sawAvailability = true;
      total += value;
    }
  }

  return sawAvailability ? total : undefined;
}

function formatDistrictShowTime(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const trimmed = value.trim();
  if (/\b(?:[01]?\d|2[0-3])[:.][0-5]\d\s?(?:AM|PM|am|pm)\b/.test(trimmed)) {
    return trimmed.replace(".", ":").replace(/\s+/g, " ").toUpperCase();
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(trimmed)) {
    const utcDate = new Date(`${trimmed.slice(0, 16)}:00Z`);
    if (!Number.isNaN(utcDate.getTime())) {
      return new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
      })
        .format(utcDate)
        .replace(/\s+/g, " ")
        .toUpperCase();
    }
  }

  return trimmed;
}

function mergeDistrictAvailabilities(records: TheatreAvailability[]): TheatreAvailability[] {
  const byTheatre = new Map<string, TheatreAvailability>();

  for (const record of records) {
    const key = normalizeText(record.theatre);
    const previous = byTheatre.get(key);
    if (!previous) {
      byTheatre.set(key, record);
      continue;
    }

    previous.shows = mergeShows(previous.shows, record.shows);
    if (record.status === AvailabilityStatus.Available) {
      previous.status = AvailabilityStatus.Available;
    }
    if (!previous.bookingUrl && record.bookingUrl) {
      previous.bookingUrl = record.bookingUrl;
    }
    if (!previous.sourceUrl && record.sourceUrl) {
      previous.sourceUrl = record.sourceUrl;
    }
  }

  return [...byTheatre.values()];
}

function mergeShows(left: Showtime[], right: Showtime[]): Showtime[] {
  const byStartTime = new Map<string, Showtime>();
  for (const show of [...left, ...right]) {
    if (!byStartTime.has(show.startTime)) {
      byStartTime.set(show.startTime, { ...show });
    }
  }

  return [...byStartTime.values()].sort((leftShow, rightShow) =>
    leftShow.startTime.localeCompare(rightShow.startTime)
  );
}

function walkObjects(value: unknown, visitor: (object: unknown, path: string) => void): void {
  const seen = new WeakSet<object>();

  function visit(current: unknown, path: string): void {
    if (!current || typeof current !== "object") {
      return;
    }

    if (seen.has(current)) {
      return;
    }
    seen.add(current);
    visitor(current, path);

    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }

    for (const [key, child] of Object.entries(current)) {
      visit(child, `${path}.${key}`);
    }
  }

  visit(value, "$");
}
