#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { ConsoleNotifier, NotifierChain, TelegramNotifier } from "./notifier/telegram.js";
import { createProviders } from "./providers/index.js";
import { JsonStateStore } from "./storage/state.js";
import {
  AvailabilityStatus,
  type Notifier,
  type TheatreAvailability,
  type TheatreTarget,
  type WatcherConfig
} from "./types.js";
import { sleep } from "./utils/duration.js";
import { ConsoleLogger } from "./utils/logger.js";
import { theatreNamesForTargets, theatreTargetsForProvider } from "./utils/theatres.js";

interface RunSummary {
  providerErrors: number;
  notificationErrors: number;
  availableCount: number;
  notificationCount: number;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = new ConsoleLogger(config.logLevel);
  const notifier = createNotifier(config, logger);

  if (process.argv.includes("--test-alert")) {
    await sendTestAlert(config, notifier, logger);
    return;
  }

  const state = new JsonStateStore(config.stateFile);
  const providers = createProviders(config.providers);

  logger.info("Movie booking watcher started.", {
    movie: config.movie,
    city: config.city,
    theatres: config.theatreTargets.map((target) => ({
      id: target.id,
      name: target.name,
      providers: target.providers,
      priority: target.priority
    })),
    providers: config.providers,
    notificationMode: config.notificationMode,
    runOnce: config.runOnce,
    discoverOnly: config.discoverOnly
  });

  let stopping = false;
  process.once("SIGINT", () => {
    stopping = true;
    logger.warn("Received SIGINT; stopping after current run.");
  });
  process.once("SIGTERM", () => {
    stopping = true;
    logger.warn("Received SIGTERM; stopping after current run.");
  });

  do {
    const summary = await runOnce(config, state, providers, notifier, logger);
    await state.save();

    if (summary.providerErrors > 0 && config.failOnProviderError) {
      process.exitCode = 1;
    }
    if (summary.notificationErrors > 0 && config.failOnNotificationError) {
      process.exitCode = 1;
    }

    if (config.runOnce || stopping) {
      break;
    }

    logger.info("Sleeping until next poll.", {
      pollIntervalMs: config.pollIntervalMs
    });
    await sleep(config.pollIntervalMs);
  } while (!stopping);
}

async function runOnce(
  config: WatcherConfig,
  state: JsonStateStore,
  providers: ReturnType<typeof createProviders>,
  notifier: Notifier,
  logger: ConsoleLogger
): Promise<RunSummary> {
  const summary: RunSummary = {
    providerErrors: 0,
    notificationErrors: 0,
    availableCount: 0,
    notificationCount: 0
  };

  for (const provider of providers) {
    const providerLogger = logger.child({ provider: provider.name });
    const theatreTargets = theatreTargetsForProvider(config.theatreTargets, provider.name);
    const theatres = theatreNamesForTargets(theatreTargets);

    if (theatreTargets.length === 0) {
      providerLogger.warn("No theatre targets configured for provider; skipping.");
      continue;
    }

    try {
      const result = await provider.check({
        movie: config.movie,
        city: config.city,
        theatres,
        theatreTargets,
        config,
        logger: providerLogger
      });

      if (result.errors.length > 0) {
        summary.providerErrors += result.errors.length;
        providerLogger.warn("Provider completed with errors.", {
          errors: result.errors,
          diagnostics: result.diagnostics
        });
      } else {
        providerLogger.info("Provider completed.", {
          availabilityRecords: result.availabilities.length,
          diagnostics: result.diagnostics
        });
      }

      if (config.discoverOnly) {
        continue;
      }

      for (const availability of result.availabilities) {
        if (availability.status === AvailabilityStatus.Available) {
          summary.availableCount += 1;
        }

        const shouldNotify = await state.shouldNotify(availability, {
          notificationMode: config.notificationMode
        });
        if (!shouldNotify) {
          await state.saveObservation(availability);
          continue;
        }

        const timestamp = new Date().toISOString();
        try {
          await notifier.notify({ availability, timestamp });
          summary.notificationCount += 1;
          await state.saveObservation(availability, config.telegram.enabled ? timestamp : undefined);
        } catch (error) {
          summary.notificationErrors += 1;
          providerLogger.error("Notification failed.", {
            theatre: availability.theatre,
            error: error instanceof Error ? error.message : String(error)
          });
          await state.saveObservation(availability);
        }
      }
    } catch (error) {
      summary.providerErrors += 1;
      providerLogger.error("Provider failed.", {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  logger.info("Watcher run completed.", { ...summary });
  return summary;
}

function createNotifier(config: WatcherConfig, logger: ConsoleLogger): Notifier {
  if (!config.telegram.enabled) {
    return new ConsoleNotifier(logger);
  }

  return new NotifierChain([new TelegramNotifier(config.telegram, logger)]);
}

async function sendTestAlert(
  config: WatcherConfig,
  notifier: Notifier,
  logger: ConsoleLogger
): Promise<void> {
  const target = selectTestAlertTarget(config);
  const timestamp = new Date().toISOString();
  const availability: TheatreAvailability = {
    provider: target.providers?.[0] ?? "bookmyshow",
    movie: config.movie,
    city: config.city,
    theatre: target.name,
    theatreId: target.id,
    theatrePriority: target.priority,
    status: AvailabilityStatus.Available,
    shows: [{ startTime: "TEST ALERT - no real show detected" }],
    checkedAt: timestamp,
    diagnostics: {
      synthetic: true,
      reason: "Manual Telegram alert test. This is not real booking availability."
    }
  };

  if (target.chain) {
    availability.theatreChain = target.chain;
  }
  const bookingUrl =
    config.providerOptions.bookmyshow?.startUrls[0] ??
    config.providerOptions.district?.startUrls[0];
  if (bookingUrl) {
    availability.bookingUrl = bookingUrl;
  }

  logger.info("Sending synthetic Telegram alert test.", {
    theatre: availability.theatre,
    theatreId: availability.theatreId,
    provider: availability.provider
  });
  await notifier.notify({ availability, timestamp });
}

function selectTestAlertTarget(config: WatcherConfig): TheatreTarget {
  const requestedId = process.env.TEST_ALERT_THEATRE_ID;
  const requestedTarget = requestedId
    ? config.theatreTargets.find((target) => target.id === requestedId)
    : undefined;
  const bookMyShowTarget = theatreTargetsForProvider(config.theatreTargets, "bookmyshow")[0];
  const target = requestedTarget ?? bookMyShowTarget ?? config.theatreTargets[0];

  if (!target) {
    throw new Error("No theatre target is configured for test alert.");
  }

  return target;
}

main().catch((error: unknown) => {
  const logger = new ConsoleLogger("error");
  logger.error("Fatal watcher error.", {
    error: error instanceof Error ? error.message : String(error)
  });
  process.exitCode = 1;
});
