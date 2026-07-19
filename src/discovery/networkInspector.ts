import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page, type Response } from "playwright";
import { extractBookMyShowDomAvailability } from "./bookmyshowDomExtractor.js";
import { extractDistrictDomAvailability } from "./districtDomExtractor.js";
import { extractDistrictAvailabilityFromJson } from "./districtStructuredExtractor.js";
import {
  extractAvailabilityFromJson,
  type AvailabilityExtractionInput,
  payloadContainsTargetSignal
} from "./availabilityExtractor.js";
import type { Logger, TheatreAvailability } from "../types.js";
import { truncate } from "../utils/text.js";

export interface NetworkInspectorOptions {
  provider: string;
  startUrls: string[];
  movie: string;
  city: string;
  theatres: string[];
  headless: boolean;
  timeoutMs: number;
  discoveryDir: string;
  logger: Logger;
}

export interface ApiCandidateSummary {
  method: string;
  url: string;
  status: number;
  resourceType: string;
  requestHeaders: Record<string, string>;
  postData?: string;
  responsePreview?: string;
}

export interface NetworkInspectionResult {
  provider: string;
  checkedAt: string;
  responsesSeen: number;
  jsonResponsesSeen: number;
  candidates: ApiCandidateSummary[];
  availabilities: TheatreAvailability[];
  errors: string[];
  artifactPath?: string;
}

const interestingResourceTypes = new Set(["xhr", "fetch"]);

export class NetworkInspector {
  async inspect(options: NetworkInspectorOptions): Promise<NetworkInspectionResult> {
    const checkedAt = new Date().toISOString();
    const candidates: ApiCandidateSummary[] = [];
    const availabilities: TheatreAvailability[] = [];
    const errors: string[] = [];
    let responsesSeen = 0;
    let jsonResponsesSeen = 0;
    let browser: Browser | undefined;
    let context: BrowserContext | undefined;

    try {
      browser = await chromium.launch({ headless: options.headless });
      context = await browser.newContext({
        locale: "en-IN",
        timezoneId: "Asia/Kolkata",
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
      });

      const page = await context.newPage();
      const pendingResponses: Promise<void>[] = [];
      page.on("response", (response) => {
        const responseTask = this.handleResponse(response, options, checkedAt)
          .then((result) => {
            responsesSeen += 1;
            if (!result) {
              return;
            }
            jsonResponsesSeen += 1;
            if (result.candidate) {
              candidates.push(result.candidate);
            }
            availabilities.push(...result.availabilities);
          })
          .catch((error: unknown) => {
            errors.push(error instanceof Error ? error.message : String(error));
          });
        pendingResponses.push(responseTask);
      });

      for (const url of options.startUrls) {
        options.logger.info("Inspecting provider network traffic.", {
          provider: options.provider,
          url
        });

        try {
          await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: options.timeoutMs
          });
          await page.waitForLoadState("networkidle", { timeout: Math.min(10_000, options.timeoutMs) });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push(`Navigation failed for ${url}: ${message}`);
        }

        await page.waitForTimeout(2_000);
        availabilities.push(
          ...(await this.extractPageContent(page, options, checkedAt, url))
        );
      }

      await Promise.allSettled(pendingResponses);
    } finally {
      if (context) {
        await context.close().catch(() => undefined);
      }
      if (browser) {
        await browser.close().catch(() => undefined);
      }
    }

    const result: NetworkInspectionResult = {
      provider: options.provider,
      checkedAt,
      responsesSeen,
      jsonResponsesSeen,
      candidates,
      availabilities,
      errors
    };

    const artifactPath = await this.writeArtifact(options.discoveryDir, options.provider, result);
    result.artifactPath = artifactPath;
    return result;
  }

  private async handleResponse(
    response: Response,
    options: NetworkInspectorOptions,
    checkedAt: string
  ): Promise<
    | {
        candidate?: ApiCandidateSummary;
        availabilities: TheatreAvailability[];
      }
    | undefined
  > {
    const request = response.request();
    const resourceType = request.resourceType();
    const headers = response.headers();
    const contentType = headers["content-type"] ?? "";
    const looksJson = contentType.includes("json") || response.url().includes("/api/");

    if (!interestingResourceTypes.has(resourceType) && !looksJson) {
      return undefined;
    }

    const payload = await readJsonPayload(response);
    if (payload === undefined) {
      return undefined;
    }

    const sourceUrl = response.url();
    const extractionInput = {
      provider: options.provider,
      movie: options.movie,
      city: options.city,
      theatres: options.theatres,
      sourceUrl,
      checkedAt,
      cityIsImplicit: true
    };
    const extracted = extractProviderAvailabilityFromJson(payload, extractionInput);

    const hasSignal = payloadContainsTargetSignal(payload, {
      movie: options.movie,
      city: options.city,
      theatres: options.theatres,
      sourceUrl
    });

    const result: {
      candidate?: ApiCandidateSummary;
      availabilities: TheatreAvailability[];
    } = { availabilities: extracted };

    if (hasSignal) {
      result.candidate = buildCandidateSummary(response, payload);
    }

    return result;
  }

  private async extractPageContent(
    page: Page,
    options: NetworkInspectorOptions,
    checkedAt: string,
    sourceUrl: string
  ): Promise<TheatreAvailability[]> {
    const availabilities: TheatreAvailability[] = [];

    if (options.provider === "bookmyshow") {
      availabilities.push(
        ...(await extractBookMyShowDomAvailability(page, {
          provider: options.provider,
          movie: options.movie,
          city: options.city,
          theatres: options.theatres,
          sourceUrl,
          checkedAt
        }))
      );
    }

    if (options.provider === "district") {
      availabilities.push(
        ...(await extractDistrictDomAvailability(page, {
          provider: options.provider,
          movie: options.movie,
          city: options.city,
          theatres: options.theatres,
          sourceUrl,
          checkedAt
        }))
      );
    }

    const nextDataText = await page
      .locator("#__NEXT_DATA__")
      .textContent({ timeout: 1_000 })
      .catch(() => null);

    if (nextDataText) {
      try {
        const nextData = JSON.parse(nextDataText) as unknown;
        availabilities.push(
          ...extractProviderAvailabilityFromJson(nextData, {
            provider: options.provider,
            movie: options.movie,
            city: options.city,
            theatres: options.theatres,
            sourceUrl,
            checkedAt,
            cityIsImplicit: true
          })
        );
      } catch {
        options.logger.debug("Unable to parse embedded __NEXT_DATA__ JSON.", {
          provider: options.provider,
          sourceUrl
        });
      }
    }

    return availabilities;
  }

  private async writeArtifact(
    discoveryDir: string,
    provider: string,
    result: NetworkInspectionResult
  ): Promise<string> {
    await mkdir(discoveryDir, { recursive: true });
    const artifactPath = join(discoveryDir, `${provider}-latest.json`);
    await writeFile(
      artifactPath,
      `${JSON.stringify(
        {
          ...result,
          artifactPath: undefined
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    return artifactPath;
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

async function readJsonPayload(response: Response): Promise<unknown | undefined> {
  try {
    return await response.json();
  } catch {
    try {
      const text = await response.text();
      const trimmed = text.trim();
      if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
        return undefined;
      }
      return JSON.parse(trimmed) as unknown;
    } catch {
      return undefined;
    }
  }
}

function buildCandidateSummary(response: Response, payload: unknown): ApiCandidateSummary {
  const request = response.request();
  const requestHeaders = redactHeaders(request.headers());
  const postData = request.postData();
  const summary: ApiCandidateSummary = {
    method: request.method(),
    url: response.url(),
    status: response.status(),
    resourceType: request.resourceType(),
    requestHeaders,
    responsePreview: truncate(JSON.stringify(payload).replace(/\s+/g, " "), 2_000)
  };

  if (postData) {
    summary.postData = truncate(postData, 2_000);
  }

  return summary;
}

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const sensitiveNames = new Set([
    "authorization",
    "cookie",
    "set-cookie",
    "x-access-token",
    "x-auth-token",
    "x-csrf-token"
  ]);

  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      sensitiveNames.has(key.toLowerCase()) ? "[redacted]" : value
    ])
  );
}
