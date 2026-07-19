import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { NotificationMode } from "../src/types.js";

describe("loadConfig", () => {
  it("loads structured theatre JSON with normalized providers and priority", () => {
    const config = loadConfig({
      CONFIG_FILE: "/tmp/movie-booking-watcher-missing-config.json",
      THEATRES_JSON: JSON.stringify([
        {
          id: "pvr-vr-chennai-anna-nagar",
          name: "PVR: VR Chennai, Anna Nagar",
          chain: "PVR",
          providers: ["BookMyShow"],
          priority: 1
        },
        {
          id: "ega-cinemas-kilpauk",
          name: "EGA Cinemas (RGB LASER | Dolby Audio | Couple Sofa), Kilpauk, Chennai",
          chain: "EGA",
          providers: ["District"],
          priority: 2
        }
      ]),
      PROVIDERS: "BookMyShow,District"
    });

    expect(config.providers).toEqual(["bookmyshow", "district"]);
    expect(config.theatreTargets).toEqual([
      {
        id: "pvr-vr-chennai-anna-nagar",
        name: "PVR: VR Chennai, Anna Nagar",
        chain: "PVR",
        providers: ["bookmyshow"],
        priority: 1
      },
      {
        id: "ega-cinemas-kilpauk",
        name: "EGA Cinemas (RGB LASER | Dolby Audio | Couple Sofa), Kilpauk, Chennai",
        chain: "EGA",
        providers: ["district"],
        priority: 2
      }
    ]);
  });

  it("supports repeat notifications while availability remains open", () => {
    const config = loadConfig({
      CONFIG_FILE: "/tmp/movie-booking-watcher-missing-config.json",
      NOTIFICATION_MODE: "while_available"
    });

    expect(config.notificationMode).toBe(NotificationMode.WhileAvailable);
  });
});
