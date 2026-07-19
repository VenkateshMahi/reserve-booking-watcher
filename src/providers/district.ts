import { ApiFirstProvider } from "./apiFirstProvider.js";

function citySlug(city: string): string {
  return city.trim().toLowerCase().replace(/\s+/g, "-");
}

export class DistrictProvider extends ApiFirstProvider {
  constructor() {
    super({
      name: "district",
      defaultStartUrls(city) {
        return [`https://www.district.in/${citySlug(city)}/movies`];
      }
    });
  }
}
