import axios, { type AxiosInstance, type AxiosRequestConfig } from "axios";
import { NetworkInspector } from "../discovery/networkInspector.js";
import {
  extractAvailabilityFromJson,
  type AvailabilityExtractionInput
} from "../discovery/availabilityExtractor.js";
import { extractDistrictAvailabilityFromJson } from "../discovery/districtStructuredExtractor.js";
import {
  AvailabilityStatus,
  ShowAvailabilityStatus,
  type ApiEndpointConfig,
  type AvailabilityProvider,
  type Logger,
  type ProviderCheckContext,
  type ProviderCheckResult,
  type ProviderRuntimeOptions,
  type Showtime,
  type TheatreAvailability
} from "../types.js";
import { RateLimiter } from "../utils/rateLimiter.js";
import { withRetry } from "../utils/retry.js";
import {
  availabilityIdentity,
  findMatchingTheatreTarget,
  sortAvailabilitiesByPriority
} from "../utils/theatres.js";

export interface ApiFirstProviderConfig {
  name: string;
  defaultStartUrls(city: string): string[];
}

export class ApiFirstProvider implements AvailabilityProvider {
  readonly name: string;
  private readonly client: AxiosInstance;
  private readonly networkInspector: NetworkInspector;

  constructor(
    private readonly providerConfig: ApiFirstProviderConfig,
    client?: AxiosInstance,
    networkInspector?: NetworkInspector
  ) {
    this.name = providerConfig.name;
    this.client = client ?? axios.create();
    this.networkInspector = networkInspector ?? new NetworkInspector();
  }

  async check(context: ProviderCheckContext): Promise<ProviderCheckResult> {
    const checkedAt = new Date().toISOString();
    const logger = context.logger.child({ provider: this.name });
    const options = this.runtimeOptions(context);
    const errors: string[] = [];
    const diagnostics: Record<string, unknown> = {
      apiEndpointCount: options.apiEndpoints.length,
      startUrls: options.startUrls,
      targetTheatreCount: context.theatreTargets.length
    };

    let availabilities: TheatreAvailability[] = [];
    let apiSucceeded = false;

    if (options.apiEndpoints.length > 0) {
      const apiResult = await this.checkApiEndpoints(context, options, checkedAt, logger);
      apiSucceeded = apiResult.successCount > 0;
      availabilities = availabilities.concat(apiResult.availabilities);
      errors.push(...apiResult.errors);
      diagnostics.apiSuccessCount = apiResult.successCount;
      diagnostics.apiAvailabilityCount = apiResult.availabilities.length;
    }

    const shouldInspectNetwork =
      context.config.discoverOnly ||
      (context.config.browserFallback &&
        (options.apiEndpoints.length === 0 || !apiSucceeded || availabilities.length === 0));

    if (shouldInspectNetwork && options.startUrls.length > 0) {
      try {
        const inspection = await this.networkInspector.inspect({
          provider: this.name,
          startUrls: options.startUrls,
          movie: context.movie,
          city: context.city,
          theatres: context.theatres,
          headless: context.config.playwrightHeadless,
          timeoutMs: context.config.providerTimeoutMs,
          discoveryDir: context.config.discoveryDir,
          logger
        });
        availabilities = availabilities.concat(inspection.availabilities);
        errors.push(...inspection.errors);
        diagnostics.network = {
          responsesSeen: inspection.responsesSeen,
          jsonResponsesSeen: inspection.jsonResponsesSeen,
          candidates: inspection.candidates.length,
          artifactPath: inspection.artifactPath
        };
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    availabilities = this.mergeAndNormalize(
      this.enrichAvailabilities(availabilities, context)
    );

    if (availabilities.length === 0 && (apiSucceeded || shouldInspectNetwork)) {
      availabilities = this.syntheticUnavailable(context, checkedAt, options.startUrls[0]);
    }

    return {
      provider: this.name,
      checkedAt,
      availabilities,
      diagnostics,
      errors
    };
  }

  private runtimeOptions(context: ProviderCheckContext): ProviderRuntimeOptions {
    return (
      context.config.providerOptions[this.name] ?? {
        startUrls: this.providerConfig.defaultStartUrls(context.city),
        apiEndpoints: []
      }
    );
  }

  private async checkApiEndpoints(
    context: ProviderCheckContext,
    options: ProviderRuntimeOptions,
    checkedAt: string,
    logger: Logger
  ): Promise<{
    successCount: number;
    availabilities: TheatreAvailability[];
    errors: string[];
  }> {
    const limiter = new RateLimiter(context.config.minRequestDelayMs);
    const errors: string[] = [];
    const availabilities: TheatreAvailability[] = [];
    let successCount = 0;

    for (const endpoint of options.apiEndpoints) {
      try {
        const responseData = await limiter.schedule(() =>
          this.requestEndpoint(endpoint, context, logger)
        );
        successCount += 1;
        availabilities.push(
          ...extractProviderAvailabilityFromJson(responseData, {
            provider: this.name,
            movie: context.movie,
            city: context.city,
            theatres: context.theatres,
            sourceUrl: endpoint.url,
            checkedAt,
            cityIsImplicit: true
          })
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`API endpoint failed: ${endpoint.url}: ${message}`);
      }
    }

    return { successCount, availabilities, errors };
  }

  private async requestEndpoint(
    endpoint: ApiEndpointConfig,
    context: ProviderCheckContext,
    logger: Logger
  ): Promise<unknown> {
    return withRetry(
      async (attempt) => {
        logger.debug("Requesting provider API endpoint.", {
          url: endpoint.url,
          method: endpoint.method ?? "GET",
          attempt
        });

        const requestConfig: AxiosRequestConfig = {
          url: endpoint.url,
          method: endpoint.method ?? "GET",
          timeout: endpoint.timeoutMs ?? context.config.requestTimeoutMs
        };

        if (endpoint.headers) {
          requestConfig.headers = endpoint.headers;
        }

        if (endpoint.body !== undefined) {
          requestConfig.data = endpoint.body;
        }

        const response = await this.client.request(requestConfig);
        return response.data as unknown;
      },
      {
        retries: 2,
        initialDelayMs: 1_000,
        maxDelayMs: 8_000,
        factor: 2,
        jitter: true,
        shouldRetry: (error) => {
          if (!axios.isAxiosError(error)) {
            return true;
          }
          const status = error.response?.status;
          return status === undefined || status === 429 || status >= 500;
        }
      }
    );
  }

  private syntheticUnavailable(
    context: ProviderCheckContext,
    checkedAt: string,
    sourceUrl: string | undefined
  ): TheatreAvailability[] {
    return context.theatreTargets.map((target) => {
      const availability: TheatreAvailability = {
        provider: this.name,
        movie: context.movie,
        city: context.city,
        theatre: target.name,
        theatreId: target.id,
        theatrePriority: target.priority,
        status: AvailabilityStatus.NotAvailable,
        shows: [],
        checkedAt,
        diagnostics: {
          synthetic: true,
          reason: "No matching available booking records were found in provider responses."
        }
      };

      if (target.chain) {
        availability.theatreChain = target.chain;
      }
      if (sourceUrl) {
        availability.sourceUrl = sourceUrl;
      }

      return availability;
    });
  }

  private mergeAndNormalize(records: TheatreAvailability[]): TheatreAvailability[] {
    const merged = new Map<string, TheatreAvailability>();
    for (const record of records) {
      if (record.status === AvailabilityStatus.Unknown) {
        continue;
      }

      const key = availabilityIdentity(record);
      const previous = merged.get(key);
      if (!previous) {
        merged.set(key, record);
        continue;
      }

      previous.shows = mergeShows(previous.shows, record.shows);

      if (record.status === AvailabilityStatus.Available) {
        previous.status = AvailabilityStatus.Available;
      }
      if (!previous.bookingUrl && record.bookingUrl) {
        previous.bookingUrl = record.bookingUrl;
      }
      if (!previous.sourceUrl && record.sourceUrl) {
        previous.sourceUrl = record.sourceUrl;
      }
    }

    return sortAvailabilitiesByPriority([...merged.values()]);
  }

  private enrichAvailabilities(
    records: TheatreAvailability[],
    context: ProviderCheckContext
  ): TheatreAvailability[] {
    return records.map((record) => {
      const target = findMatchingTheatreTarget(record.theatre, context.theatreTargets);
      if (!target) {
        return record;
      }

      const next: TheatreAvailability = {
        ...record,
        theatre: target.name,
        theatreId: target.id,
        theatrePriority: target.priority,
        diagnostics: {
          ...(record.diagnostics ?? {}),
          matchedTheatre: {
            id: target.id,
            providerTheatreName: record.theatre,
            priority: target.priority
          }
        }
      };

      if (target.chain) {
        next.theatreChain = target.chain;
      }

      return next;
    });
  }
}

function extractProviderAvailabilityFromJson(
  payload: unknown,
  input: AvailabilityExtractionInput
): TheatreAvailability[] {
  if (input.provider === "district") {
    return extractDistrictAvailabilityFromJson(payload, input);
  }

  return extractAvailabilityFromJson(payload, input);
}

function mergeShows(left: Showtime[], right: Showtime[]): Showtime[] {
  const byStartTime = new Map<string, Showtime>();
  for (const show of [...left, ...right]) {
    const previous = byStartTime.get(show.startTime);
    if (!previous) {
      byStartTime.set(show.startTime, { ...show });
      continue;
    }

    if (show.status && strongerShowStatus(show.status, previous.status) === show.status) {
      previous.status = show.status;
      if (show.rawStatus) {
        previous.rawStatus = show.rawStatus;
      }
    }
  }

  return [...byStartTime.values()].sort((leftShow, rightShow) =>
    leftShow.startTime.localeCompare(rightShow.startTime)
  );
}

function strongerShowStatus(
  left: ShowAvailabilityStatus,
  right: ShowAvailabilityStatus | undefined
): ShowAvailabilityStatus {
  if (!right) {
    return left;
  }

  const priority: Record<ShowAvailabilityStatus, number> = {
    [ShowAvailabilityStatus.Available]: 5,
    [ShowAvailabilityStatus.FastFilling]: 4,
    [ShowAvailabilityStatus.AlmostFull]: 3,
    [ShowAvailabilityStatus.SoldOut]: 2,
    [ShowAvailabilityStatus.Unknown]: 1
  };

  return priority[left] > priority[right] ? left : right;
}
