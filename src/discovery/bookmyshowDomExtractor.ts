import type { Page } from "playwright";
import {
  AvailabilityStatus,
  ShowAvailabilityStatus,
  type Showtime,
  type TheatreAvailability
} from "../types.js";
import { matchesConfiguredTheatre } from "../utils/text.js";

export interface BookMyShowDomExtractionInput {
  provider: string;
  movie: string;
  city: string;
  theatres: string[];
  sourceUrl: string;
  checkedAt: string;
}

interface RawBookMyShowShow {
  time: string;
  className: string;
  color: string;
  borderColor: string;
  backgroundColor: string;
  ariaLabel: string;
}

interface RawBookMyShowCard {
  theatre: string;
  shows: RawBookMyShowShow[];
}

const bookableStatuses = new Set<ShowAvailabilityStatus>([
  ShowAvailabilityStatus.Available,
  ShowAvailabilityStatus.FastFilling,
  ShowAvailabilityStatus.AlmostFull
]);

export async function extractBookMyShowDomAvailability(
  page: Page,
  input: BookMyShowDomExtractionInput
): Promise<TheatreAvailability[]> {
  const rawCards = await page.evaluate(() => {
    const timePattern = /\b(?:[01]?\d|2[0-3])[:.][0-5]\d\s?(?:AM|PM|am|pm)\b/;
    const roots = Array.from(document.querySelectorAll("div")).filter((element) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }

      return (
        element.style.position === "absolute" &&
        Boolean(element.querySelector("a[alt]")) &&
        Boolean(element.querySelector("[role='button']")) &&
        timePattern.test(element.innerText)
      );
    });

    return roots.map((root) => {
      const theatre =
        root.querySelector("a[alt]")?.getAttribute("alt") ??
        root.querySelector("span")?.textContent ??
        "";
      const shows = Array.from(root.querySelectorAll("[role='button']"))
        .filter((element): element is HTMLElement => element instanceof HTMLElement)
        .map((element) => {
          const ariaLabel = element.getAttribute("aria-label") ?? "";
          const text = element.innerText || element.textContent || "";
          const time = (ariaLabel || text).match(timePattern)?.[0] ?? "";
          const style = getComputedStyle(element);
          return {
            time,
            className: element.getAttribute("class") ?? "",
            color: style.color,
            borderColor: style.borderColor,
            backgroundColor: style.backgroundColor,
            ariaLabel
          };
        })
        .filter((show) => show.time !== "");

      return { theatre, shows };
    });
  });

  return rawCards
    .filter((card) => matchesConfiguredTheatre(card.theatre, input.theatres))
    .map((card) => toAvailability(card, input));
}

export function classifyBookMyShowShowStatusFromStyles(input: {
  color: string;
  borderColor: string;
  backgroundColor?: string;
  className?: string;
}): { status: ShowAvailabilityStatus; rawStatus: string } {
  const border = parseRgb(input.borderColor);
  const color = parseRgb(input.color);
  const statusColor = border ?? color;

  if (!statusColor) {
    return { status: ShowAvailabilityStatus.Unknown, rawStatus: "Unknown" };
  }

  if (isGrey(statusColor)) {
    return { status: ShowAvailabilityStatus.SoldOut, rawStatus: "Sold Out" };
  }

  if (isGreen(statusColor)) {
    return { status: ShowAvailabilityStatus.Available, rawStatus: "Available" };
  }

  if (isYellowOrOrange(statusColor)) {
    return { status: ShowAvailabilityStatus.FastFilling, rawStatus: "Fast Filling" };
  }

  if (isRed(statusColor)) {
    return { status: ShowAvailabilityStatus.AlmostFull, rawStatus: "Almost Full" };
  }

  return { status: ShowAvailabilityStatus.Unknown, rawStatus: "Unknown" };
}

function toAvailability(
  card: RawBookMyShowCard,
  input: BookMyShowDomExtractionInput
): TheatreAvailability {
  const shows = card.shows.map((show) => toShowtime(show));
  const bookableShows = shows.filter(
    (show) => show.status && bookableStatuses.has(show.status)
  );
  const status =
    bookableShows.length > 0
      ? AvailabilityStatus.Available
      : shows.length > 0 && shows.every((show) => show.status === ShowAvailabilityStatus.SoldOut)
        ? AvailabilityStatus.NotAvailable
        : AvailabilityStatus.Unknown;

  const availability: TheatreAvailability = {
    provider: input.provider,
    movie: input.movie,
    city: input.city,
    theatre: card.theatre,
    status,
    shows: bookableShows,
    checkedAt: input.checkedAt,
    bookingUrl: input.sourceUrl,
    sourceUrl: input.sourceUrl,
    diagnostics: {
      extractedFrom: "bookmyshowDom",
      rawShowCount: card.shows.length,
      bookableShowCount: bookableShows.length
    }
  };

  return availability;
}

function toShowtime(show: RawBookMyShowShow): Showtime {
  const classified = classifyBookMyShowShowStatusFromStyles(show);
  const showtime: Showtime = {
    startTime: show.time,
    status: classified.status,
    rawStatus: classified.rawStatus,
    raw: {
      className: show.className,
      color: show.color,
      borderColor: show.borderColor,
      backgroundColor: show.backgroundColor
    }
  };

  if (show.ariaLabel) {
    showtime.label = show.ariaLabel;
  }

  return showtime;
}

function parseRgb(value: string): { r: number; g: number; b: number } | undefined {
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value);
  if (!match?.[1] || !match[2] || !match[3]) {
    return undefined;
  }

  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3])
  };
}

function isGrey(color: { r: number; g: number; b: number }): boolean {
  return (
    Math.abs(color.r - color.g) <= 8 &&
    Math.abs(color.g - color.b) <= 8 &&
    color.r >= 120
  );
}

function isGreen(color: { r: number; g: number; b: number }): boolean {
  return color.g >= 130 && color.r <= 120 && color.b <= 140;
}

function isYellowOrOrange(color: { r: number; g: number; b: number }): boolean {
  return color.r >= 180 && color.g >= 120 && color.b <= 80;
}

function isRed(color: { r: number; g: number; b: number }): boolean {
  return color.r >= 170 && color.g < 120 && color.b < 120;
}
