import {
  AvailabilityStatus,
  ShowAvailabilityStatus,
  type Showtime,
  type TheatreAvailability
} from "../types.js";
import {
  looseIncludes,
  matchesConfiguredTheatre,
  normalizeText,
  uniqueStrings
} from "../utils/text.js";

export interface AvailabilityExtractionInput {
  provider: string;
  movie: string;
  city: string;
  theatres: string[];
  sourceUrl?: string;
  checkedAt: string;
  cityIsImplicit?: boolean;
}

interface PrimitiveRecord {
  path: string;
  key: string;
  value: string | number | boolean | null;
}

const theatreKeyHints = [
  "theatre",
  "theater",
  "venue",
  "cinema",
  "property",
  "multiplex",
  "location",
  "name"
];

const bookingKeyHints = ["book", "ticket", "seat", "show", "availability", "sale"];
const statusKeyHints = ["status", "availability", "seat", "inventory", "booking"];
const bookableShowStatuses = new Set<ShowAvailabilityStatus>([
  ShowAvailabilityStatus.Available,
  ShowAvailabilityStatus.FastFilling,
  ShowAvailabilityStatus.AlmostFull
]);

export function extractAvailabilityFromJson(
  payload: unknown,
  input: AvailabilityExtractionInput
): TheatreAvailability[] {
  const payloadStrings = collectStrings(payload, 2_000);
  const payloadText = payloadStrings.join(" ");
  const payloadHasMovie = looseIncludes(payloadText, input.movie);
  const payloadHasCity =
    input.cityIsImplicit === true ||
    looseIncludes(payloadText, input.city) ||
    (input.sourceUrl ? looseIncludes(input.sourceUrl, input.city) : false);

  if (!payloadHasMovie) {
    return [];
  }

  const records: TheatreAvailability[] = [];
  walkObjects(payload, (object, path) => {
    const objectStrings = collectStrings(object, 250);
    const objectText = objectStrings.join(" ");
    const objectHasMovie = payloadHasMovie || looseIncludes(objectText, input.movie);
    const objectHasCity = payloadHasCity || looseIncludes(objectText, input.city);
    if (!objectHasMovie || !objectHasCity) {
      return;
    }

    const theatreNames = inferTheatreNames(object, objectStrings, input.theatres);
    if (theatreNames.length === 0) {
      return;
    }

    const shows = inferShowtimes(object);
    const inferredBookingUrl = inferBookingUrl(object);
    const bookingUrl = inferredBookingUrl ?? input.sourceUrl;
    const status = inferAvailabilityStatus(object, shows, inferredBookingUrl);

    for (const theatre of theatreNames) {
      const availability: TheatreAvailability = {
        provider: input.provider,
        movie: input.movie,
        city: input.city,
        theatre,
        status,
        shows,
        checkedAt: input.checkedAt,
        diagnostics: {
          extractedFrom: path,
          source: input.sourceUrl
        }
      };

      if (bookingUrl) {
        availability.bookingUrl = bookingUrl;
      }
      if (input.sourceUrl) {
        availability.sourceUrl = input.sourceUrl;
      }

      records.push(availability);
    }
  });

  return mergeAvailabilities(records);
}

export function payloadContainsTargetSignal(
  payload: unknown,
  input: Pick<AvailabilityExtractionInput, "movie" | "city" | "theatres" | "sourceUrl">
): boolean {
  const strings = collectStrings(payload, 1_500);
  const text = `${strings.join(" ")} ${input.sourceUrl ?? ""}`;
  const hasMovie = looseIncludes(text, input.movie);
  const hasCity = looseIncludes(text, input.city);
  const hasTheatre = strings.some((value) => matchesConfiguredTheatre(value, input.theatres));
  return hasMovie || (hasCity && hasTheatre);
}

function inferTheatreNames(
  object: unknown,
  strings: string[],
  configuredTheatres: string[]
): string[] {
  const primitiveRecords = collectPrimitiveRecords(object, 400);
  const hintedValues = primitiveRecords
    .filter((record) => theatreKeyHints.some((hint) => normalizeText(record.key).includes(hint)))
    .map((record) => String(record.value));

  const candidates = uniqueStrings([...hintedValues, ...strings])
    .filter((value) => value.length <= 160)
    .filter((value) => matchesConfiguredTheatre(value, configuredTheatres));

  return candidates;
}

function inferShowtimes(object: unknown): Showtime[] {
  const records = collectPrimitiveRecords(object, 1_000);
  const byLabel = new Map<string, Showtime>();
  const seatStatus = inferSeatStatus(object);

  for (const record of records) {
    if (typeof record.value !== "string" && typeof record.value !== "number") {
      continue;
    }

    const value = String(record.value);
    const normalizedKey = normalizeText(record.key);
    const keyLooksTimeRelated =
      normalizedKey.includes("time") ||
      normalizedKey.includes("session") ||
      normalizedKey.includes("show") ||
      normalizedKey.includes("date");

    for (const match of value.matchAll(/\b(?:[01]?\d|2[0-3])[:.][0-5]\d\s?(?:AM|PM|am|pm)?\b/g)) {
      addShowtime(
        byLabel,
        match[0].replace(".", ":").replace(/\s+/g, " ").trim(),
        seatStatus
      );
    }

    for (const match of value.matchAll(/\b(?:[1-9]|1[0-2])\s?(?:AM|PM|am|pm)\b/g)) {
      addShowtime(byLabel, match[0].replace(/\s+/g, " ").toUpperCase(), seatStatus);
    }

    if (keyLooksTimeRelated && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
      addShowtime(byLabel, value, seatStatus);
    }
  }

  return [...byLabel.values()];
}

function inferBookingUrl(object: unknown): string | undefined {
  const records = collectPrimitiveRecords(object, 600);
  const urls = records
    .filter((record) => typeof record.value === "string")
    .map((record) => String(record.value))
    .filter((value) => /^https?:\/\//i.test(value));

  const bookingUrl = urls.find((url) =>
    bookingKeyHints.some((hint) => normalizeText(url).includes(hint))
  );
  return bookingUrl ?? urls[0];
}

function inferAvailabilityStatus(
  object: unknown,
  shows: Showtime[],
  bookingUrl: string | undefined
): AvailabilityStatus {
  const records = collectPrimitiveRecords(object, 1_000);
  const text = records.map((record) => String(record.value)).join(" ");
  const normalizedText = normalizeText(text);
  const explicitStatuses = inferSeatStatuses(object);

  if (explicitStatuses.some((status) => bookableShowStatuses.has(status.status))) {
    return AvailabilityStatus.Available;
  }

  if (
    explicitStatuses.length > 0 &&
    explicitStatuses.every((status) => status.status === ShowAvailabilityStatus.SoldOut)
  ) {
    return AvailabilityStatus.NotAvailable;
  }

  const unavailableTerms = [
    "sold out",
    "not available",
    "unavailable",
    "coming soon",
    "notify me",
    "booking closed",
    "booking not open",
    "sale not started",
    "pre booking not started"
  ];

  if (unavailableTerms.some((term) => normalizedText.includes(normalizeText(term)))) {
    return AvailabilityStatus.NotAvailable;
  }

  for (const record of records) {
    const normalizedKey = normalizeText(record.key);
    const normalizedValue = normalizeText(String(record.value));

    if (
      typeof record.value === "boolean" &&
      record.value === true &&
      /\b(available|open|enabled|bookable|active|sale)\b/.test(normalizedKey)
    ) {
      return AvailabilityStatus.Available;
    }

    if (
      typeof record.value === "boolean" &&
      record.value === false &&
      /\b(sold out|soldout|disabled|blocked|closed)\b/.test(normalizedKey)
    ) {
      return AvailabilityStatus.Available;
    }

    if (
      /\b(status|availability|booking|sale)\b/.test(normalizedKey) &&
      /\b(open|live|active|bookable|sale)\b/.test(normalizedValue)
    ) {
      return AvailabilityStatus.Available;
    }
  }

  if (shows.some((show) => show.status && bookableShowStatuses.has(show.status))) {
    return AvailabilityStatus.Available;
  }

  if (bookingUrl) {
    return AvailabilityStatus.Available;
  }

  return AvailabilityStatus.Unknown;
}

function mergeAvailabilities(records: TheatreAvailability[]): TheatreAvailability[] {
  const byTheatre = new Map<string, TheatreAvailability>();

  for (const record of records) {
    const key = normalizeText(record.theatre);
    const previous = byTheatre.get(key);
    if (!previous) {
      byTheatre.set(key, record);
      continue;
    }

    previous.shows = mergeShows(previous.shows, record.shows);
    previous.status = strongerStatus(previous.status, record.status);
    if (!previous.bookingUrl && record.bookingUrl) {
      previous.bookingUrl = record.bookingUrl;
    }
    if (!previous.sourceUrl && record.sourceUrl) {
      previous.sourceUrl = record.sourceUrl;
    }
  }

  return [...byTheatre.values()];
}

function addShowtime(
  byLabel: Map<string, Showtime>,
  startTime: string,
  seatStatus: SeatStatusMatch | undefined
): void {
  const existing = byLabel.get(startTime);
  if (existing) {
    if (!existing.status && seatStatus) {
      existing.status = seatStatus.status;
      existing.rawStatus = seatStatus.rawStatus;
    }
    return;
  }

  const show: Showtime = { startTime };
  if (seatStatus) {
    show.status = seatStatus.status;
    show.rawStatus = seatStatus.rawStatus;
  }
  byLabel.set(startTime, show);
}

function mergeShows(left: Showtime[], right: Showtime[]): Showtime[] {
  const byStartTime = new Map<string, Showtime>();
  for (const show of [...left, ...right]) {
    const previous = byStartTime.get(show.startTime);
    if (!previous) {
      byStartTime.set(show.startTime, { ...show });
      continue;
    }

    if (show.status && strongerShowStatus(show.status, previous.status) === show.status) {
      previous.status = show.status;
      if (show.rawStatus) {
        previous.rawStatus = show.rawStatus;
      }
    }
  }

  return [...byStartTime.values()];
}

function strongerShowStatus(
  left: ShowAvailabilityStatus,
  right: ShowAvailabilityStatus | undefined
): ShowAvailabilityStatus {
  if (!right) {
    return left;
  }

  const priority: Record<ShowAvailabilityStatus, number> = {
    [ShowAvailabilityStatus.Available]: 5,
    [ShowAvailabilityStatus.FastFilling]: 4,
    [ShowAvailabilityStatus.AlmostFull]: 3,
    [ShowAvailabilityStatus.SoldOut]: 2,
    [ShowAvailabilityStatus.Unknown]: 1
  };

  return priority[left] > priority[right] ? left : right;
}

interface SeatStatusMatch {
  status: ShowAvailabilityStatus;
  rawStatus: string;
}

function inferSeatStatus(object: unknown): SeatStatusMatch | undefined {
  return inferSeatStatuses(object)[0];
}

function inferSeatStatuses(object: unknown): SeatStatusMatch[] {
  const records = collectPrimitiveRecords(object, 500);
  const matches: SeatStatusMatch[] = [];

  for (const record of records) {
    if (typeof record.value !== "string") {
      continue;
    }

    const normalizedKey = normalizeText(record.key);
    const keyLooksStatusRelated = statusKeyHints.some((hint) =>
      normalizedKey.includes(hint)
    );
    const status = normalizeShowAvailabilityStatus(record.value);
    if (status && keyLooksStatusRelated) {
      matches.push({ status, rawStatus: record.value });
    }
  }

  return matches;
}

export function normalizeShowAvailabilityStatus(
  value: string
): ShowAvailabilityStatus | undefined {
  const normalized = normalizeText(value);

  if (normalized === "sold out" || normalized === "soldout") {
    return ShowAvailabilityStatus.SoldOut;
  }

  if (normalized === "fast filling" || normalized === "filling fast") {
    return ShowAvailabilityStatus.FastFilling;
  }

  if (normalized === "almost full") {
    return ShowAvailabilityStatus.AlmostFull;
  }

  if (normalized === "available") {
    return ShowAvailabilityStatus.Available;
  }

  return undefined;
}

function strongerStatus(
  left: AvailabilityStatus,
  right: AvailabilityStatus
): AvailabilityStatus {
  const priority: Record<AvailabilityStatus, number> = {
    [AvailabilityStatus.Available]: 3,
    [AvailabilityStatus.NotAvailable]: 2,
    [AvailabilityStatus.Unknown]: 1
  };
  return priority[right] > priority[left] ? right : left;
}

function collectStrings(value: unknown, limit: number): string[] {
  return collectPrimitiveRecords(value, limit)
    .filter((record) => typeof record.value === "string")
    .map((record) => String(record.value));
}

function collectPrimitiveRecords(value: unknown, limit: number): PrimitiveRecord[] {
  const records: PrimitiveRecord[] = [];
  const seen = new WeakSet<object>();

  function visit(current: unknown, path: string, key: string): void {
    if (records.length >= limit) {
      return;
    }

    if (
      current === null ||
      typeof current === "string" ||
      typeof current === "number" ||
      typeof current === "boolean"
    ) {
      records.push({ path, key, value: current });
      return;
    }

    if (typeof current !== "object") {
      return;
    }

    if (seen.has(current)) {
      return;
    }
    seen.add(current);

    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}[${index}]`, String(index)));
      return;
    }

    for (const [childKey, childValue] of Object.entries(current)) {
      visit(childValue, path ? `${path}.${childKey}` : childKey, childKey);
    }
  }

  visit(value, "$", "$");
  return records;
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
