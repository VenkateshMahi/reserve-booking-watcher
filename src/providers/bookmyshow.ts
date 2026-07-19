import { ApiFirstProvider } from "./apiFirstProvider.js";

function citySlug(city: string): string {
  return city.trim().toLowerCase().replace(/\s+/g, "-");
}

export class BookMyShowProvider extends ApiFirstProvider {
  constructor() {
    super({
      name: "bookmyshow",
      defaultStartUrls(city) {
        return [`https://in.bookmyshow.com/explore/movies-${citySlug(city)}`];
      }
    });
  }
}
