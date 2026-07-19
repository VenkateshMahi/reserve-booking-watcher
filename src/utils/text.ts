export function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeProviderId(value: string): string {
  return normalizeText(value).replace(/\s+/g, "");
}

export function looseIncludes(haystack: string, needle: string): boolean {
  const normalizedHaystack = normalizeText(haystack);
  const normalizedNeedle = normalizeText(needle);
  if (!normalizedHaystack || !normalizedNeedle) {
    return false;
  }
  return normalizedHaystack.includes(normalizedNeedle);
}

export function isPvrInoxWildcard(value: string): boolean {
  const normalized = normalizeText(value);
  return (
    normalized === "any pvr inox theatre" ||
    normalized === "pvr inox" ||
    normalized === "any pvr inox" ||
    normalized === "any pvr" ||
    normalized === "any inox"
  );
}

export function matchesConfiguredTheatre(theatreName: string, configuredTheatres: string[]): boolean {
  const normalizedTheatre = normalizeText(theatreName);
  if (!normalizedTheatre || !looksLikeTheatreAlias(normalizedTheatre)) {
    return false;
  }

  return configuredTheatres.some((configured) => {
    if (isPvrInoxWildcard(configured)) {
      return /\b(pvr|inox)\b/.test(normalizedTheatre);
    }

    const normalizedConfigured = normalizeText(configured);
    return (
      normalizedTheatre.includes(normalizedConfigured) ||
      normalizedConfigured.includes(normalizedTheatre) ||
      tokenSubsetMatch(normalizedTheatre, normalizedConfigured)
    );
  });
}

const knownTheatreAliasTokens = new Set([
  "ags",
  "aerohub",
  "ampa",
  "casino",
  "cinepolis",
  "cinema",
  "cinemas",
  "ega",
  "escape",
  "inox",
  "kamala",
  "luxe",
  "miraj",
  "murugan",
  "palazzo",
  "pvr",
  "rakki",
  "sangam",
  "sathyam",
  "vr"
]);

function looksLikeTheatreAlias(value: string): boolean {
  const tokens = value.split(" ").filter(Boolean);
  if (tokens.length >= 3 && value.length >= 10) {
    return true;
  }

  if (tokens.length >= 2 && tokens.some((token) => knownTheatreAliasTokens.has(token))) {
    return true;
  }

  return false;
}

function tokenSubsetMatch(left: string, right: string): boolean {
  const leftTokens = left.split(" ").filter(Boolean);
  const rightTokens = right.split(" ").filter(Boolean);
  if (leftTokens.length < 3 || rightTokens.length < 3) {
    return false;
  }

  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  return (
    leftTokens.every((token) => rightSet.has(token)) ||
    rightTokens.every((token) => leftSet.has(token))
  );
}

export function concreteTheatreNames(configuredTheatres: string[]): string[] {
  return configuredTheatres.filter((theatre) => !isPvrInoxWildcard(theatre));
}

export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 1))}...`;
}
