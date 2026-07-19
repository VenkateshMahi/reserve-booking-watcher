import type { AvailabilityProvider } from "../types.js";
import { BookMyShowProvider } from "./bookmyshow.js";
import { DistrictProvider } from "./district.js";

export function createProviders(enabledProviders: string[]): AvailabilityProvider[] {
  const registry: Record<string, () => AvailabilityProvider> = {
    bookmyshow: () => new BookMyShowProvider(),
    district: () => new DistrictProvider()
  };

  return enabledProviders.map((name) => {
    const factory = registry[name];
    if (!factory) {
      throw new Error(`Unknown provider "${name}". Registered providers: ${Object.keys(registry).join(", ")}`);
    }
    return factory();
  });
}
