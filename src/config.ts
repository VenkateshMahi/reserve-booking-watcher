import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  ApiEndpointConfig,
  LogLevel,
  NotificationMode,
  ProviderRuntimeOptions,
  TheatreTarget,
  WatcherConfig
} from "./types.js";
import { NotificationMode as NotificationModes } from "./types.js";
import { parseDurationMs } from "./utils/duration.js";
import { normalizeProviderId } from "./utils/text.js";
import { sortTheatreTargets } from "./utils/theatres.js";

type TheatreTargetInput =
  | string
  | {
      id?: string;
      name: string;
      chain?: string;
      providers?: string[];
      priority?: number;
      aliases?: string[];
    };

const defaultTheatreTargets: TheatreTarget[] = [
  {
    id: "pvr-vr-chennai-anna-nagar",
    name: "PVR: VR Chennai, Anna Nagar",
    chain: "PVR",
    providers: ["bookmyshow"],
    priority: 1
  },
  {
    id: "pvr-palazzo-vadapalani",
    name: "PVR: Palazzo, Nexus Vijaya Mall",
    chain: "PVR",
    providers: ["bookmyshow"],
    priority: 1
  },
  {
    id: "pvr-ampa-mall",
    name: "PVR: Ampa Mall, Nelson Manickam Road",
    chain: "PVR",
    providers: ["bookmyshow"],
    priority: 1
  },
  {
    id: "ags-tnagar",
    name: "AGS Cinemas: T. Nagar",
    chain: "AGS",
    providers: ["bookmyshow"],
    priority: 1
  },
  {
    id: "ags-villivakkam",
    name: "AGS Cinemas: Villivakkam",
    chain: "AGS",
    providers: ["bookmyshow"],
    priority: 1
  },
  {
    id: "rakki-rgb-laser-4k-ambattur",
    name: "Rakki RGB Laser 4K - Ambattur",
    chain: "Rakki",
    providers: ["district"],
    priority: 1
  },
  {
    id: "kamala-cinemas-vadapalani",
    name: "Kamala Cinemas 4K RGB Laser Dolby, Vadapalani, Chennai",
    chain: "Kamala",
    providers: ["district"],
    priority: 1
  },
  {
    id: "murugan-cinemas-plf-ambattur",
    name: "Murugan Cinemas PLF 4K, Ambattur, Chennai",
    chain: "Murugan",
    providers: ["district"],
    priority: 1
  },
  {
    id: "sangam-cinemas",
    name: "Sangam Cinemas",
    chain: "Independent",
    providers: ["bookmyshow"],
    priority: 2
  },
  {
    id: "sangam-cinemas-kilpauk",
    name: "Sangam Cinemas 4K RGB Laser Dolby Atmos, Kilpauk, Chennai",
    chain: "Sangam",
    providers: ["district"],
    priority: 2
  },
  {
    id: "ags-maduravoyal",
    name: "AGS Cinemas: Maduravoyal",
    chain: "AGS",
    providers: ["bookmyshow"],
    priority: 2
  },
  {
    id: "pvr-aerohub-chennai-airport",
    name: "PVR: Aerohub, Chennai Airport",
    chain: "PVR",
    providers: ["bookmyshow"],
    priority: 2
  },
  {
    id: "vels-theatres-chennai",
    name: "Vels Theatres: Chennai",
    chain: "Vels",
    providers: ["bookmyshow"],
    priority: 3
  },
  {
    id: "ega-cinemas-kilpauk",
    name: "EGA Cinemas (RGB LASER | Dolby Audio | Couple Sofa), Kilpauk, Chennai",
    chain: "EGA",
    providers: ["district"],
    priority: 2
  }
];

interface FileConfig {
  movie?: string;
  city?: string;
  theatres?: TheatreTargetInput[];
  theatreTargets?: TheatreTargetInput[];
  providers?: string[];
  pollInterval?: string;
  runOnce?: boolean;
  browserFallback?: boolean;
  playwrightHeadless?: boolean;
  providerTimeoutMs?: number;
  requestTimeoutMs?: number;
  minRequestDelayMs?: number;
  stateFile?: string;
  discoveryDir?: string;
  logLevel?: LogLevel;
  notificationMode?: NotificationMode;
  failOnProviderError?: boolean;
  failOnNotificationError?: boolean;
  providerOptions?: Record<string, Partial<ProviderRuntimeOptions>>;
}

function splitCsv(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function readFileConfig(env: NodeJS.ProcessEnv): FileConfig {
  const configPath = env.CONFIG_FILE ?? "watcher.config.json";
  const absolutePath = resolve(configPath);
  if (!existsSync(absolutePath)) {
    return {};
  }

  const raw = readFileSync(absolutePath, "utf8");
  return JSON.parse(raw) as FileConfig;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  return ["1", "true", "yes", "y", "on"].includes(value.trim().toLowerCase());
}

function parseLogLevel(value: string | undefined, fallback: LogLevel): LogLevel {
  if (value === "debug" || value === "info" || value === "warn" || value === "error") {
    return value;
  }
  return fallback;
}

function parseNotificationMode(
  value: string | undefined,
  fallback: NotificationMode
): NotificationMode {
  const normalized = value?.trim().toLowerCase().replace(/_/g, "-");
  if (!normalized) {
    return fallback;
  }

  if (normalized === "while-available" || normalized === "until-sold-out") {
    return NotificationModes.WhileAvailable;
  }

  if (normalized === "state-change" || normalized === "on-change") {
    return NotificationModes.StateChange;
  }

  return fallback;
}

function parseApiEndpoints(value: string | undefined): ApiEndpointConfig[] {
  if (!value || value.trim() === "") {
    return [];
  }

  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as ApiEndpointConfig[];
    return parsed.map((endpoint) => ({
      ...endpoint,
      method: endpoint.method ?? "GET"
    }));
  }

  return splitCsv(trimmed).map((url) => ({ method: "GET", url }));
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeTheatreTarget(input: TheatreTargetInput, index: number): TheatreTarget {
  if (typeof input === "string") {
    return {
      id: slugify(input) || `theatre-${index + 1}`,
      name: input,
      priority: 1
    };
  }

  if (!input.name || input.name.trim() === "") {
    throw new Error(`Invalid theatre target at index ${index}: "name" is required.`);
  }

  const providers = input.providers?.map(normalizeProviderId).filter(Boolean);
  const aliases = input.aliases?.map((alias) => alias.trim()).filter(Boolean);
  const target: TheatreTarget = {
    id: input.id?.trim() || slugify(input.name) || `theatre-${index + 1}`,
    name: input.name.trim(),
    priority: input.priority ?? 1
  };

  if (input.chain?.trim()) {
    target.chain = input.chain.trim();
  }
  if (providers && providers.length > 0) {
    target.providers = providers;
  }
  if (aliases && aliases.length > 0) {
    target.aliases = aliases;
  }

  return target;
}

function normalizeTheatreTargets(inputs: TheatreTargetInput[]): TheatreTarget[] {
  return sortTheatreTargets(inputs.map((input, index) => normalizeTheatreTarget(input, index)));
}

function parseTheatreTargets(env: NodeJS.ProcessEnv, fileConfig: FileConfig): TheatreTarget[] {
  if (env.THEATRES_JSON && env.THEATRES_JSON.trim() !== "") {
    return normalizeTheatreTargets(JSON.parse(env.THEATRES_JSON) as TheatreTargetInput[]);
  }

  if (env.THEATRES_FILE && env.THEATRES_FILE.trim() !== "") {
    const raw = readFileSync(resolve(env.THEATRES_FILE), "utf8");
    return normalizeTheatreTargets(JSON.parse(raw) as TheatreTargetInput[]);
  }

  const envTheatres = splitCsv(env.THEATRES);
  if (envTheatres.length > 0) {
    return normalizeTheatreTargets(envTheatres);
  }

  if (fileConfig.theatreTargets && fileConfig.theatreTargets.length > 0) {
    return normalizeTheatreTargets(fileConfig.theatreTargets);
  }

  if (fileConfig.theatres && fileConfig.theatres.length > 0) {
    return normalizeTheatreTargets(fileConfig.theatres);
  }

  return sortTheatreTargets(defaultTheatreTargets);
}

function providerOptions(
  provider: string,
  fileConfig: FileConfig,
  env: NodeJS.ProcessEnv
): ProviderRuntimeOptions {
  const fromFile = fileConfig.providerOptions?.[provider] ?? {};
  const prefix = provider.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const envStartUrls = splitCsv(env[`${prefix}_START_URLS`]);
  const envApiEndpoints = parseApiEndpoints(env[`${prefix}_API_ENDPOINTS`]);

  const startUrls =
    envStartUrls.length > 0
      ? envStartUrls
      : fromFile.startUrls && fromFile.startUrls.length > 0
        ? fromFile.startUrls
        : defaultStartUrls(provider, fileConfig.city ?? env.CITY ?? "Chennai");

  const apiEndpoints =
    envApiEndpoints.length > 0
      ? envApiEndpoints
      : (fromFile.apiEndpoints ?? []).map((endpoint) => ({
          ...endpoint,
          method: endpoint.method ?? "GET"
        }));

  return { startUrls, apiEndpoints };
}

function defaultStartUrls(provider: string, city: string): string[] {
  const citySlug = city.trim().toLowerCase().replace(/\s+/g, "-");
  if (provider === "bookmyshow") {
    return [`https://in.bookmyshow.com/explore/movies-${citySlug}`];
  }
  if (provider === "district") {
    return [`https://www.district.in/${citySlug}/movies`];
  }
  return [];
}

function argPresent(name: string): boolean {
  return process.argv.includes(name);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WatcherConfig {
  const fileConfig = readFileConfig(env);
  const movie = env.MOVIE_NAME ?? fileConfig.movie ?? "Jana Nayagan";
  const city = env.CITY ?? fileConfig.city ?? "Chennai";
  const theatreTargets = parseTheatreTargets(env, fileConfig);
  const providers = splitCsv(env.PROVIDERS);
  const configuredProviders =
    providers.length > 0 ? providers : fileConfig.providers ?? ["bookmyshow", "district"];
  const normalizedProviders = configuredProviders.map((provider) =>
    provider.trim().toLowerCase()
  );

  const pollIntervalMs = parseDurationMs(env.POLL_INTERVAL ?? fileConfig.pollInterval, 300_000);
  const runOnce =
    argPresent("--watch") || parseBoolean(env.WATCH_MODE, false)
      ? false
      : parseBoolean(env.RUN_ONCE, fileConfig.runOnce ?? true);

  const providerRuntimeOptions: Record<string, ProviderRuntimeOptions> = {};
  for (const provider of normalizedProviders) {
    providerRuntimeOptions[provider] = providerOptions(provider, fileConfig, env);
  }

  const botToken = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  const telegram = {
    enabled: Boolean(botToken && chatId),
    timeoutMs: Number(env.TELEGRAM_TIMEOUT_MS ?? 10_000),
    disableWebPagePreview: parseBoolean(env.TELEGRAM_DISABLE_WEB_PAGE_PREVIEW, false)
  };

  if (botToken) {
    Object.assign(telegram, { botToken });
  }
  if (chatId) {
    Object.assign(telegram, { chatId });
  }

  return {
    movie,
    city,
    theatres: theatreTargets.map((target) => target.name),
    theatreTargets,
    providers: normalizedProviders,
    pollIntervalMs,
    runOnce,
    discoverOnly: argPresent("--discover") || parseBoolean(env.DISCOVER_ONLY, false),
    browserFallback: parseBoolean(
      env.BROWSER_FALLBACK,
      fileConfig.browserFallback ?? true
    ),
    playwrightHeadless: parseBoolean(
      env.PLAYWRIGHT_HEADLESS,
      fileConfig.playwrightHeadless ?? true
    ),
    providerTimeoutMs: Number(env.PROVIDER_TIMEOUT_MS ?? fileConfig.providerTimeoutMs ?? 30_000),
    requestTimeoutMs: Number(env.REQUEST_TIMEOUT_MS ?? fileConfig.requestTimeoutMs ?? 15_000),
    minRequestDelayMs: Number(env.MIN_REQUEST_DELAY_MS ?? fileConfig.minRequestDelayMs ?? 750),
    stateFile: env.STATE_FILE ?? fileConfig.stateFile ?? ".watcher/state.json",
    discoveryDir: env.DISCOVERY_DIR ?? fileConfig.discoveryDir ?? ".watcher/discovery",
    logLevel: parseLogLevel(env.LOG_LEVEL, fileConfig.logLevel ?? "info"),
    notificationMode: parseNotificationMode(
      env.NOTIFICATION_MODE,
      fileConfig.notificationMode ?? NotificationModes.StateChange
    ),
    failOnProviderError: parseBoolean(
      env.FAIL_ON_PROVIDER_ERROR,
      fileConfig.failOnProviderError ?? false
    ),
    failOnNotificationError: parseBoolean(
      env.FAIL_ON_NOTIFICATION_ERROR,
      fileConfig.failOnNotificationError ?? true
    ),
    telegram,
    providerOptions: providerRuntimeOptions
  };
}
