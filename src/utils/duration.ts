const units: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000
};

export function parseDurationMs(value: string | undefined, fallbackMs: number): number {
  if (!value || value.trim() === "") {
    return fallbackMs;
  }

  const trimmed = value.trim().toLowerCase();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }

  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h)$/.exec(trimmed);
  if (!match) {
    throw new Error(`Invalid duration "${value}". Use values such as 30s, 5m, 1h, or milliseconds.`);
  }

  const amountText = match[1];
  const unit = match[2];
  if (!amountText || !unit) {
    throw new Error(`Invalid duration "${value}".`);
  }

  const amount = Number(amountText);
  const multiplier = units[unit];
  if (multiplier === undefined) {
    throw new Error(`Invalid duration unit "${unit}".`);
  }

  return Math.round(amount * multiplier);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
