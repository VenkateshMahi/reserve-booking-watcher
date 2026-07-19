import { describe, expect, it } from "vitest";
import {
  extractAvailabilityFromJson,
  normalizeShowAvailabilityStatus
} from "../src/discovery/availabilityExtractor.js";
import { AvailabilityStatus, ShowAvailabilityStatus } from "../src/types.js";

const baseInput = {
  provider: "bookmyshow",
  movie: "Jana Nayagan",
  city: "Chennai",
  theatres: ["PVR Palazzo", "Luxe", "Any PVR/INOX theatre"],
  sourceUrl: "https://in.bookmyshow.com/explore/movies-chennai",
  checkedAt: "2026-07-19T00:00:00.000Z",
  cityIsImplicit: true
};

describe("extractAvailabilityFromJson", () => {
  it("extracts available shows for configured theatres from nested API JSON", () => {
    const payload = {
      city: "Chennai",
      movie: {
        title: "Jana Nayagan",
        venues: [
          {
            venueName: "PVR Palazzo Nexus Vijaya Mall",
            bookingStatus: "OPEN",
            sessions: [
              { showTime: "4:00 AM", bookingUrl: "https://tickets.example/book/palazzo/1" },
              { showTime: "7:30 AM", bookingUrl: "https://tickets.example/book/palazzo/2" }
            ]
          }
        ]
      }
    };

    const result = extractAvailabilityFromJson(payload, baseInput);

    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe(AvailabilityStatus.Available);
    expect(result[0]?.theatre).toBe("PVR Palazzo Nexus Vijaya Mall");
    expect(result[0]?.shows.map((show) => show.startTime)).toEqual(["4:00 AM", "7:30 AM"]);
    expect(result[0]?.bookingUrl).toBe("https://tickets.example/book/palazzo/1");
  });

  it("supports the Any PVR/INOX theatre wildcard", () => {
    const payload = {
      movieName: "Jana Nayagan",
      venue: {
        name: "INOX National Arcot Road",
        available: true,
        shows: [{ time: "10:45 AM" }]
      }
    };

    const result = extractAvailabilityFromJson(payload, baseInput);

    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe(AvailabilityStatus.Available);
    expect(result[0]?.theatre).toBe("INOX National Arcot Road");
  });

  it("does not extract theatres when the target movie is absent", () => {
    const payload = {
      city: "Chennai",
      venues: [{ venueName: "PVR Palazzo", shows: [{ time: "4:00 AM" }] }]
    };

    expect(extractAvailabilityFromJson(payload, baseInput)).toEqual([]);
  });

  it("does not mark a cinema directory entry available just because the source URL exists", () => {
    const payload = {
      movie: "Jana Nayagan",
      city: "Chennai",
      cinemas: [{ name: "PVR Palazzo Nexus Vijaya Mall" }]
    };

    const result = extractAvailabilityFromJson(payload, baseInput);

    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe(AvailabilityStatus.Unknown);
  });

  it.each([
    ["Available", ShowAvailabilityStatus.Available],
    ["Fast Filling", ShowAvailabilityStatus.FastFilling],
    ["Filling fast", ShowAvailabilityStatus.FastFilling],
    ["Almost Full", ShowAvailabilityStatus.AlmostFull],
    ["Sold Out", ShowAvailabilityStatus.SoldOut]
  ])("normalizes provider show status %s", (rawStatus, expected) => {
    expect(normalizeShowAvailabilityStatus(rawStatus)).toBe(expected);
  });

  it.each(["Available", "Fast Filling", "Filling fast", "Almost Full"])(
    "marks bookings open for provider status %s",
    (rawStatus) => {
      const payload = {
        movie: "Jana Nayagan",
        city: "Chennai",
        theatre: {
          name: "PVR Palazzo Nexus Vijaya Mall",
          shows: [{ showTime: "4:00 AM", seatStatus: rawStatus }]
        }
      };

      const result = extractAvailabilityFromJson(payload, baseInput);

      expect(result).toHaveLength(1);
      expect(result[0]?.status).toBe(AvailabilityStatus.Available);
      expect(result[0]?.shows[0]?.status).not.toBe(ShowAvailabilityStatus.SoldOut);
      expect(result[0]?.shows[0]?.rawStatus).toBe(rawStatus);
    }
  );

  it("does not mark bookings open when all explicit provider statuses are sold out", () => {
    const payload = {
      movie: "Jana Nayagan",
      city: "Chennai",
      theatre: {
        name: "PVR Palazzo Nexus Vijaya Mall",
        shows: [
          { showTime: "4:00 AM", seatStatus: "Sold Out" },
          { showTime: "7:30 AM", seatStatus: "Sold Out" }
        ]
      }
    };

    const result = extractAvailabilityFromJson(payload, baseInput);

    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe(AvailabilityStatus.NotAvailable);
    expect(result[0]?.shows.map((show) => show.rawStatus)).toEqual(["Sold Out", "Sold Out"]);
  });

  it("does not apply page-level status legend text to unrelated showtimes", () => {
    const payload = {
      movie: "Jana Nayagan",
      city: "Chennai",
      legend: ["Available", "Filling fast", "Almost Full"],
      theatre: {
        name: "PVR Palazzo Nexus Vijaya Mall",
        shows: [{ showTime: "4:00 AM" }, { showTime: "7:30 AM" }]
      }
    };

    const result = extractAvailabilityFromJson(payload, baseInput);

    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe(AvailabilityStatus.Unknown);
    expect(result[0]?.shows.map((show) => show.rawStatus)).toEqual([undefined, undefined]);
  });
});
