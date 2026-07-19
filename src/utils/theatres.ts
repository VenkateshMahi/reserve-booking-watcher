import type { TheatreAvailability, TheatreTarget } from "../types.js";
import {
  matchesConfiguredTheatre,
  normalizeProviderId,
  normalizeText,
  uniqueStrings
} from "./text.js";

export function sortTheatreTargets(targets: TheatreTarget[]): TheatreTarget[] {
  return [...targets].sort((left, right) => {
    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }
    return left.name.localeCompare(right.name);
  });
}

export function theatreSearchTerms(target: TheatreTarget): string[] {
  return uniqueStrings([target.name, ...(target.aliases ?? [])]);
}

export function theatreNamesForTargets(targets: TheatreTarget[]): string[] {
  return uniqueStrings(targets.flatMap((target) => theatreSearchTerms(target)));
}

export function theatreTargetsForProvider(
  targets: TheatreTarget[],
  provider: string
): TheatreTarget[] {
  const providerId = normalizeProviderId(provider);
  return sortTheatreTargets(
    targets.filter((target) => {
      if (!target.providers || target.providers.length === 0) {
        return true;
      }
      return target.providers.map(normalizeProviderId).includes(providerId);
    })
  );
}

export function findMatchingTheatreTarget(
  theatreName: string,
  targets: TheatreTarget[]
): TheatreTarget | undefined {
  return sortTheatreTargets(targets).find((target) =>
    matchesConfiguredTheatre(theatreName, theatreSearchTerms(target))
  );
}

export function sortAvailabilitiesByPriority(
  availabilities: TheatreAvailability[]
): TheatreAvailability[] {
  return [...availabilities].sort((left, right) => {
    const leftPriority = left.theatrePriority ?? Number.MAX_SAFE_INTEGER;
    const rightPriority = right.theatrePriority ?? Number.MAX_SAFE_INTEGER;
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    const theatreCompare = left.theatre.localeCompare(right.theatre);
    if (theatreCompare !== 0) {
      return theatreCompare;
    }

    return left.provider.localeCompare(right.provider);
  });
}

export function availabilityIdentity(availability: TheatreAvailability): string {
  return availability.theatreId ?? normalizeText(availability.theatre);
}
