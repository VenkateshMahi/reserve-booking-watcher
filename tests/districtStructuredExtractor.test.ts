import { describe, expect, it } from "vitest";
import { extractDistrictAvailabilityFromJson } from "../src/discovery/districtStructuredExtractor.js";
import { AvailabilityStatus, ShowAvailabilityStatus } from "../src/types.js";

const baseInput = {
  provider: "district",
  movie: "Jana Nayagan",
  city: "Chennai",
  theatres: ["Devi Cineplex, Anna Salai, Chennai"],
  sourceUrl: "https://www.district.in/movies/jana-nayagan-movie-tickets-in-chennai-MV188681",
  checkedAt: "2026-07-19T00:00:00.000Z",
  cityIsImplicit: true
};

describe("extractDistrictAvailabilityFromJson", () => {
  it("extracts only actually bookable District sessions from structured movieSessions data", () => {
    const payload = movieSessionsPayload([
      {
        showTime: "2026-07-23T03:30",
        seatStatus: "Almost Full",
        statusColor: "D",
        seatClass: "greyCol",
        disableClick: true,
        avail: 0,
        audi: "DEVI",
        scrnFmt: "2D"
      },
      {
        showTime: "2026-07-23T12:30",
        seatStatus: "Filling Fast",
        statusColor: "Y",
        seatClass: "yellowCol",
        disableClick: false,
        avail: 6,
        audi: "DEVI PARADISE",
        scrnFmt: "2D"
      },
      {
        showTime: "2026-07-23T16:30",
        seatStatus: "Available",
        statusColor: "A",
        disableClick: false,
        areas: [{ sAvail: 4 }],
        audi: "DEVI BALA",
        scrnFmt: "2D"
      }
    ]);

    const result = extractDistrictAvailabilityFromJson(payload, baseInput);

    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe(AvailabilityStatus.Available);
    expect(result[0]?.shows.map((show) => show.startTime)).toEqual(["06:00 PM", "10:00 PM"]);
    expect(result[0]?.shows.map((show) => show.status)).toEqual([
      ShowAvailabilityStatus.FastFilling,
      ShowAvailabilityStatus.Available
    ]);
  });

  it("does not alert when District sessions have bookable-looking statuses but are disabled", () => {
    const payload = movieSessionsPayload([
      {
        showTime: "2026-07-23T03:30",
        seatStatus: "Almost Full",
        statusColor: "D",
        seatClass: "greyCol",
        disableClick: true,
        avail: 0
      }
    ]);

    const result = extractDistrictAvailabilityFromJson(payload, baseInput);

    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe(AvailabilityStatus.NotAvailable);
    expect(result[0]?.shows).toEqual([]);
  });
});

function movieSessionsPayload(sessions: unknown[]): unknown {
  return {
    props: {
      pageProps: {
        data: {
          serverState: {
            movieSessions: {
              "_dhnulbeya2026-07-23": {
                pageData: {
                  nearbyCinemas: [
                    {
                      cinemaInfo: {
                        name: "Devi Cineplex, Anna Salai, Chennai",
                        chainKey: "Devi"
                      },
                      sessions
                    }
                  ]
                }
              }
            }
          }
        }
      }
    }
  };
}
