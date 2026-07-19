import type { Logger, LogLevel } from "../types.js";

const priorities: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

export class ConsoleLogger implements Logger {
  constructor(
    private readonly level: LogLevel = "info",
    private readonly bindings: Record<string, unknown> = {}
  ) {}

  debug(message: string, metadata?: Record<string, unknown>): void {
    this.write("debug", message, metadata);
  }

  info(message: string, metadata?: Record<string, unknown>): void {
    this.write("info", message, metadata);
  }

  warn(message: string, metadata?: Record<string, unknown>): void {
    this.write("warn", message, metadata);
  }

  error(message: string, metadata?: Record<string, unknown>): void {
    this.write("error", message, metadata);
  }

  child(bindings: Record<string, unknown>): Logger {
    return new ConsoleLogger(this.level, { ...this.bindings, ...bindings });
  }

  private write(level: LogLevel, message: string, metadata?: Record<string, unknown>): void {
    if (priorities[level] < priorities[this.level]) {
      return;
    }

    const entry = {
      ts: new Date().toISOString(),
      level,
      message,
      ...this.bindings,
      ...(metadata ?? {})
    };

    const line = JSON.stringify(entry);
    if (level === "error") {
      console.error(line);
      return;
    }
    if (level === "warn") {
      console.warn(line);
      return;
    }
    console.log(line);
  }
}
