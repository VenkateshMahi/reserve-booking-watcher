export const AvailabilityStatus = {
  Available: "AVAILABLE",
  NotAvailable: "NOT_AVAILABLE",
  Unknown: "UNKNOWN"
} as const;

export type AvailabilityStatus =
  (typeof AvailabilityStatus)[keyof typeof AvailabilityStatus];

export const ShowAvailabilityStatus = {
  Available: "AVAILABLE",
  FastFilling: "FAST_FILLING",
  AlmostFull: "ALMOST_FULL",
  SoldOut: "SOLD_OUT",
  Unknown: "UNKNOWN"
} as const;

export type ShowAvailabilityStatus =
  (typeof ShowAvailabilityStatus)[keyof typeof ShowAvailabilityStatus];

export const NotificationMode = {
  StateChange: "state-change",
  WhileAvailable: "while-available"
} as const;

export type NotificationMode =
  (typeof NotificationMode)[keyof typeof NotificationMode];

export type HttpMethod = "GET" | "POST";

export interface ApiEndpointConfig {
  url: string;
  method?: HttpMethod;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

export interface ProviderRuntimeOptions {
  startUrls: string[];
  apiEndpoints: ApiEndpointConfig[];
}

export interface TelegramConfig {
  enabled: boolean;
  botToken?: string;
  chatId?: string;
  timeoutMs: number;
  disableWebPagePreview: boolean;
}

export interface TheatreTarget {
  id: string;
  name: string;
  chain?: string;
  providers?: string[];
  priority: number;
  aliases?: string[];
}

export interface WatcherConfig {
  movie: string;
  city: string;
  theatres: string[];
  theatreTargets: TheatreTarget[];
  providers: string[];
  pollIntervalMs: number;
  runOnce: boolean;
  discoverOnly: boolean;
  browserFallback: boolean;
  playwrightHeadless: boolean;
  providerTimeoutMs: number;
  requestTimeoutMs: number;
  minRequestDelayMs: number;
  stateFile: string;
  discoveryDir: string;
  logLevel: LogLevel;
  notificationMode: NotificationMode;
  failOnProviderError: boolean;
  failOnNotificationError: boolean;
  telegram: TelegramConfig;
  providerOptions: Record<string, ProviderRuntimeOptions>;
}

export interface Showtime {
  startTime: string;
  status?: ShowAvailabilityStatus;
  rawStatus?: string;
  label?: string;
  language?: string;
  format?: string;
  screen?: string;
  bookingUrl?: string;
  raw?: unknown;
}

export interface TheatreAvailability {
  provider: string;
  movie: string;
  city: string;
  theatre: string;
  theatreId?: string;
  theatreChain?: string;
  theatrePriority?: number;
  status: AvailabilityStatus;
  shows: Showtime[];
  bookingUrl?: string;
  sourceUrl?: string;
  checkedAt: string;
  diagnostics?: Record<string, unknown>;
}

export interface ProviderCheckResult {
  provider: string;
  checkedAt: string;
  availabilities: TheatreAvailability[];
  diagnostics: Record<string, unknown>;
  errors: string[];
}

export interface ProviderCheckContext {
  movie: string;
  city: string;
  theatres: string[];
  theatreTargets: TheatreTarget[];
  config: WatcherConfig;
  logger: Logger;
}

export interface AvailabilityProvider {
  readonly name: string;
  check(context: ProviderCheckContext): Promise<ProviderCheckResult>;
}

export interface NotificationMessage {
  availability: TheatreAvailability;
  timestamp: string;
}

export interface Notifier {
  readonly name: string;
  notify(message: NotificationMessage): Promise<void>;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, metadata?: Record<string, unknown>): void;
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export interface StoredNotificationState {
  key: string;
  provider: string;
  movie: string;
  city: string;
  theatre: string;
  theatreId?: string;
  theatreChain?: string;
  theatrePriority?: number;
  status: AvailabilityStatus;
  showHash: string;
  shows: string[];
  bookingUrl?: string;
  lastCheckedAt: string;
  notifiedAt?: string;
}

export interface StoredState {
  version: 1;
  updatedAt: string;
  notifications: Record<string, StoredNotificationState>;
}

export function createAvailabilityKey(input: {
  provider: string;
  movie: string;
  city: string;
  theatre: string;
  theatreId?: string;
}): string {
  return [input.provider, input.city, input.movie, input.theatreId ?? input.theatre]
    .map((part) => part.trim().toLowerCase().replace(/\s+/g, " "))
    .join("|");
}
