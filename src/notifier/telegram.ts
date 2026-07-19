import axios, { type AxiosInstance } from "axios";
import type {
  Logger,
  NotificationMessage,
  Notifier,
  TelegramConfig,
  TheatreAvailability
} from "../types.js";
import { withRetry } from "../utils/retry.js";

export class TelegramNotifier implements Notifier {
  readonly name = "telegram";
  private readonly client: AxiosInstance;

  constructor(
    private readonly config: TelegramConfig,
    private readonly logger: Logger,
    client?: AxiosInstance
  ) {
    this.client =
      client ??
      axios.create({
        timeout: config.timeoutMs
      });
  }

  async notify(message: NotificationMessage): Promise<void> {
    if (!this.config.enabled || !this.config.botToken || !this.config.chatId) {
      this.logger.warn("Telegram is not configured; skipping Telegram notification.");
      return;
    }

    const url = `https://api.telegram.org/bot${this.config.botToken}/sendMessage`;
    const text = formatTelegramMessage(message.availability, message.timestamp);

    await withRetry(
      async () => {
        await this.client.post(url, {
          chat_id: this.config.chatId,
          text,
          disable_web_page_preview: this.config.disableWebPagePreview
        });
      },
      {
        retries: 2,
        initialDelayMs: 1_000,
        maxDelayMs: 5_000,
        factor: 2,
        jitter: true
      }
    );

    this.logger.info("Telegram notification sent.", {
      provider: message.availability.provider,
      theatre: message.availability.theatre
    });
  }
}

export class ConsoleNotifier implements Notifier {
  readonly name = "console";

  constructor(private readonly logger: Logger) {}

  async notify(message: NotificationMessage): Promise<void> {
    this.logger.info("Notification preview.", {
      text: formatTelegramMessage(message.availability, message.timestamp)
    });
  }
}

export class NotifierChain implements Notifier {
  readonly name = "chain";

  constructor(private readonly notifiers: Notifier[]) {}

  async notify(message: NotificationMessage): Promise<void> {
    for (const notifier of this.notifiers) {
      await notifier.notify(message);
    }
  }
}

export function formatTelegramMessage(
  availability: TheatreAvailability,
  timestamp: string
): string {
  const shows =
    availability.shows.length > 0
      ? availability.shows.map(formatShowLine).join("\n")
      : "Available - show timings were not exposed by the provider response.";
  const provider = availability.provider;
  const chainLines = availability.theatreChain
    ? ["", "Chain:", availability.theatreChain]
    : [];
  const priorityLines =
    availability.theatrePriority !== undefined
      ? ["", "Priority:", String(availability.theatrePriority)]
      : [];

  return [
    `🚨 ${availability.theatre}`,
    `🎬 ${availability.movie} - BOOKINGS OPEN`,
    "",
    "City:",
    availability.city,
    "",
    "Provider:",
    provider,
    ...chainLines,
    ...priorityLines,
    "",
    "Shows:",
    shows,
    "",
    "Book Now:",
    availability.bookingUrl ?? availability.sourceUrl ?? "Open the provider app or website.",
    "",
    "Timestamp:",
    timestamp
  ].join("\n");
}

function formatShowLine(show: TheatreAvailability["shows"][number]): string {
  if (!show.rawStatus && !show.status) {
    return show.startTime;
  }

  return `${show.startTime} - ${show.rawStatus ?? show.status}`;
}
