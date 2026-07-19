import { describe, expect, it } from "vitest";
import { matchesConfiguredTheatre } from "../src/utils/text.js";

describe("matchesConfiguredTheatre", () => {
  it("matches configured theatre aliases loosely", () => {
    expect(matchesConfiguredTheatre("PVR VR Chennai, Anna Nagar", ["PVR VR"])).toBe(true);
    expect(matchesConfiguredTheatre("PVR Palazzo", ["PVR: Palazzo, Nexus Vijaya Mall"])).toBe(true);
    expect(matchesConfiguredTheatre("Escape Cinemas", ["PVR Escape", "Escape"])).toBe(true);
  });

  it("matches PVR/INOX wildcard", () => {
    expect(matchesConfiguredTheatre("INOX Chennai Citi Centre", ["Any PVR/INOX theatre"])).toBe(true);
    expect(matchesConfiguredTheatre("PVR Sathyam Royapettah", ["Any PVR/INOX theatre"])).toBe(true);
    expect(matchesConfiguredTheatre("AGS T Nagar", ["Any PVR/INOX theatre"])).toBe(false);
  });

  it("matches shorter provider labels against long canonical names", () => {
    expect(
      matchesConfiguredTheatre("EGA Cinemas Kilpauk", [
        "EGA Cinemas (RGB LASER | Dolby Audio | Couple Sofa), Kilpauk, Chennai"
      ])
    ).toBe(true);
  });

  it("does not match non-theatre fragments inside long theatre names", () => {
    const configured = [
      "EGA Cinemas (RGB LASER | Dolby Audio | Couple Sofa), Kilpauk, Chennai"
    ];

    expect(matchesConfiguredTheatre("RGB Laser", configured)).toBe(false);
    expect(matchesConfiguredTheatre("4K", configured)).toBe(false);
    expect(matchesConfiguredTheatre("A", configured)).toBe(false);
  });
});
