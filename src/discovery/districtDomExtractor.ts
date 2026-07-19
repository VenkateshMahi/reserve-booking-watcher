import type { Page } from "playwright";
import {
  AvailabilityStatus,
  ShowAvailabilityStatus,
  type Showtime,
  type TheatreAvailability
} from "../types.js";

export interface DistrictDomExtractionInput {
  provider: string;
  movie: string;
  city: string;
  theatres: string[];
  sourceUrl: string;
  checkedAt: string;
}

interface RawDistrictShow {
  time: string;
  className: string;
  color: string;
  borderColor: string;
  backgroundColor: string;
  label: string;
}

interface RawDistrictCard {
  theatre: string;
  shows: RawDistrictShow[];
}

const bookableStatuses = new Set<ShowAvailabilityStatus>([
  ShowAvailabilityStatus.Available,
  ShowAvailabilityStatus.FastFilling,
  ShowAvailabilityStatus.AlmostFull
]);

export async function extractDistrictDomAvailability(
  page: Page,
  input: DistrictDomExtractionInput
): Promise<TheatreAvailability[]> {
  const rawCards = await page.evaluate((theatres) => {
    const timePattern = /\b(?:[01]?\d|2[0-3])[:.][0-5]\d\s?(?:AM|PM|am|pm)\b/;
    const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const normalizedTheatres = theatres.map((theatre) => ({
      name: theatre,
      normalized: normalize(theatre)
    }));

    const targetForText = (text: string) => {
      const normalizedText = normalize(text);
      return normalizedTheatres.find(
        (theatre) =>
          normalizedText.includes(theatre.normalized) ||
          theatre.normalized.includes(normalizedText)
      );
    };

    const hasShowChip = (element: Element): boolean =>
      Array.from(element.querySelectorAll("*")).some((child) => {
        if (!(child instanceof HTMLElement)) {
          return false;
        }
        const text = child.innerText || child.textContent || "";
        return text.length <= 90 && timePattern.test(text);
      });

    const candidates = Array.from(document.querySelectorAll("div, section, article"))
      .filter((element): element is HTMLElement => element instanceof HTMLElement)
      .map((element) => {
        const text = element.innerText || element.textContent || "";
        const target = targetForText(text);
        return { element, text, target };
      })
      .filter(({ text, target, element }) => {
        if (!target || text.length > 1_800 || !timePattern.test(text) || !hasShowChip(element)) {
          return false;
        }

        return !Array.from(element.children).some((child) => {
          if (!(child instanceof HTMLElement)) {
            return false;
          }
          const childText = child.innerText || child.textContent || "";
          return Boolean(targetForText(childText)) && timePattern.test(childText) && hasShowChip(child);
        });
      });

    return candidates.map(({ element, target }) => {
      const showElements = Array.from(element.querySelectorAll("*"))
        .filter((child): child is HTMLElement => child instanceof HTMLElement)
        .filter((child) => {
          const text = child.innerText || child.textContent || "";
          if (text.length > 90 || !timePattern.test(text)) {
            return false;
          }

          return !Array.from(child.children).some((grandchild) => {
            if (!(grandchild instanceof HTMLElement)) {
              return false;
            }
            const grandchildText = grandchild.innerText || grandchild.textContent || "";
            return timePattern.test(grandchildText);
          });
        });

      const shows = showElements
        .map((showElement) => {
          const text = showElement.innerText || showElement.textContent || "";
          const style = getComputedStyle(showElement);
          return {
            time: text.match(timePattern)?.[0]?.replace(/\s+/g, " ").trim() ?? "",
            className: showElement.getAttribute("class") ?? "",
            color: style.color,
            borderColor: style.borderColor,
            backgroundColor: style.backgroundColor,
            label: text.replace(/\s+/g, " ").trim()
          };
        })
        .filter((show) => show.time !== "");

      return {
        theatre: target?.name ?? "",
        shows
      };
    });
  }, input.theatres);

  return rawCards
    .filter((card) => card.theatre !== "")
    .map((card) => toAvailability(card, input));
}

export function classifyDistrictShowStatusFromStyles(input: {
  color: string;
  borderColor?: string;
  backgroundColor?: string;
  className?: string;
}): { status: ShowAvailabilityStatus; rawStatus: string } {
  const textColor = parseRgb(input.color);

  if (!textColor) {
    return { status: ShowAvailabilityStatus.Unknown, rawStatus: "Unknown" };
  }

  if (isMutedGrey(textColor)) {
    return { status: ShowAvailabilityStatus.SoldOut, rawStatus: "Sold Out" };
  }

  if (isDark(textColor)) {
    return { status: ShowAvailabilityStatus.Available, rawStatus: "Available" };
  }

  if (isYellow(textColor)) {
    return { status: ShowAvailabilityStatus.FastFilling, rawStatus: "Filling fast" };
  }

  if (isOrangeOrRed(textColor)) {
    return { status: ShowAvailabilityStatus.AlmostFull, rawStatus: "Almost Full" };
  }

  return { status: ShowAvailabilityStatus.Unknown, rawStatus: "Unknown" };
}

function toAvailability(card: RawDistrictCard, input: DistrictDomExtractionInput): TheatreAvailability {
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

  return {
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
      extractedFrom: "districtDom",
      rawShowCount: card.shows.length,
      bookableShowCount: bookableShows.length
    }
  };
}

function toShowtime(show: RawDistrictShow): Showtime {
  const classified = classifyDistrictShowStatusFromStyles(show);
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

  if (show.label) {
    showtime.label = show.label;
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

function isDark(color: { r: number; g: number; b: number }): boolean {
  return color.r <= 80 && color.g <= 80 && color.b <= 80;
}

function isMutedGrey(color: { r: number; g: number; b: number }): boolean {
  return (
    Math.abs(color.r - color.g) <= 14 &&
    Math.abs(color.g - color.b) <= 14 &&
    color.r >= 110
  );
}

function isYellow(color: { r: number; g: number; b: number }): boolean {
  return color.r >= 150 && color.g >= 130 && color.b <= 90;
}

function isOrangeOrRed(color: { r: number; g: number; b: number }): boolean {
  return color.r >= 170 && color.g >= 40 && color.g < 150 && color.b <= 110;
}
