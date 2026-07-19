import { describe, expect, it } from "vitest";
import type { TheatreTarget } from "../src/types.js";
import {
  findMatchingTheatreTarget,
  theatreTargetsForProvider
} from "../src/utils/theatres.js";

const targets: TheatreTarget[] = [
  {
    id: "pvr-vr-chennai-anna-nagar",
    name: "PVR: VR Chennai, Anna Nagar",
    chain: "PVR",
    providers: ["bookmyshow"],
    priority: 1
  },
  {
    id: "sangam-cinemas-kilpauk",
    name: "Sangam Cinemas 4K RGB Laser Dolby Atmos, Kilpauk, Chennai",
    chain: "Sangam",
    providers: ["district"],
    priority: 2
  }
];

describe("theatre target helpers", () => {
  it("filters theatre targets by provider", () => {
    expect(theatreTargetsForProvider(targets, "BookMyShow").map((target) => target.id)).toEqual([
      "pvr-vr-chennai-anna-nagar"
    ]);
    expect(theatreTargetsForProvider(targets, "District").map((target) => target.id)).toEqual([
      "sangam-cinemas-kilpauk"
    ]);
  });

  it("matches provider theatre names back to canonical target ids", () => {
    expect(findMatchingTheatreTarget("PVR VR Chennai Anna Nagar", targets)?.id).toBe(
      "pvr-vr-chennai-anna-nagar"
    );
    expect(findMatchingTheatreTarget("Sangam Cinemas", targets)?.id).toBe(
      "sangam-cinemas-kilpauk"
    );
  });
});
