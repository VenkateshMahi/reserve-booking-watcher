import { describe, expect, it } from "vitest";
import { classifyDistrictShowStatusFromStyles } from "../src/discovery/districtDomExtractor.js";
import { ShowAvailabilityStatus } from "../src/types.js";

describe("classifyDistrictShowStatusFromStyles", () => {
  it.each([
    ["muted grey sold-out chip", "rgb(176, 180, 186)", ShowAvailabilityStatus.SoldOut, "Sold Out"],
    ["black available chip", "rgb(20, 20, 20)", ShowAvailabilityStatus.Available, "Available"],
    [
      "yellow filling-fast chip",
      "rgb(204, 177, 0)",
      ShowAvailabilityStatus.FastFilling,
      "Filling fast"
    ],
    [
      "orange almost-full chip",
      "rgb(239, 80, 42)",
      ShowAvailabilityStatus.AlmostFull,
      "Almost Full"
    ]
  ])("classifies %s", (_label, color, expectedStatus, expectedRawStatus) => {
    expect(
      classifyDistrictShowStatusFromStyles({
        color,
        borderColor: "rgb(220, 220, 220)"
      })
    ).toEqual({
      status: expectedStatus,
      rawStatus: expectedRawStatus
    });
  });
});
