import { describe, expect, it } from "vitest";
import { classifyBookMyShowShowStatusFromStyles } from "../src/discovery/bookmyshowDomExtractor.js";
import { ShowAvailabilityStatus } from "../src/types.js";

describe("classifyBookMyShowShowStatusFromStyles", () => {
  it.each([
    ["grey sold-out chip", "rgb(179, 179, 179)", ShowAvailabilityStatus.SoldOut, "Sold Out"],
    [
      "yellow fast-filling chip",
      "rgb(241, 177, 3)",
      ShowAvailabilityStatus.FastFilling,
      "Fast Filling"
    ],
    ["green available chip", "rgb(74, 189, 93)", ShowAvailabilityStatus.Available, "Available"],
    ["red almost-full chip", "rgb(220, 80, 80)", ShowAvailabilityStatus.AlmostFull, "Almost Full"]
  ])("classifies %s", (_label, borderColor, expectedStatus, expectedRawStatus) => {
    expect(
      classifyBookMyShowShowStatusFromStyles({
        color: "rgb(51, 51, 51)",
        borderColor
      })
    ).toEqual({
      status: expectedStatus,
      rawStatus: expectedRawStatus
    });
  });
});
