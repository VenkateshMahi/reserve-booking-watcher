# Movie Booking Watcher

Production-oriented TypeScript watcher for movie ticket booking availability.

The default target is **Jana Nayagan** in **Chennai**, with BookMyShow and District enabled. The app is generic: change the movie, city, theatres, or providers through environment variables or `watcher.config.json`.

## What It Does

- Checks BookMyShow and District.
- Filters by movie, city, provider-specific theatres, and priority.
- Uses configured or discovered JSON/XHR APIs first.
- Falls back to Playwright network inspection only when a usable API is not configured or not working.
- Sends Telegram alerts when availability transitions from `NOT_AVAILABLE` to `AVAILABLE`.
- Persists state in `.watcher/state.json` to avoid duplicate notifications.
- Can run once for cron/GitHub Actions or loop locally with `--watch`.

## Install

```bash
cd movie-booking-watcher
npm install
npx playwright install chromium
cp .env.example .env
```

Use Node.js 20.19 or newer. The GitHub Actions workflow uses Node.js 22.

Edit `.env` with your movie, theatres, and Telegram credentials.

## Run Locally

One-shot run:

```bash
npm run dev
```

Continuous local polling:

```bash
npm run watch
```

Build and run compiled JavaScript:

```bash
npm run build
npm start
```

Run API/network discovery:

```bash
npm run discover
```

Discovery writes redacted candidate network calls to `.watcher/discovery/<provider>-latest.json`.

Send a synthetic Telegram alert to verify notification delivery:

```bash
npm run test:alert
```

This does not mean bookings are open; it only tests Telegram formatting and delivery.

## Telegram Setup

1. Open Telegram and message `@BotFather`.
2. Run `/newbot` and follow the prompts.
3. Copy the bot token into `TELEGRAM_BOT_TOKEN`.
4. Send a message to your new bot from the Telegram account or group you want alerts in.
5. Get your chat id:

```bash
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates"
```

6. Copy the chat id into `TELEGRAM_CHAT_ID`.

Alert format:

```text
🚨 PVR: Palazzo, Nexus Vijaya Mall
🎬 Jana Nayagan - BOOKINGS OPEN

City:
Chennai

Provider:
bookmyshow

Chain:
PVR

Priority:
1

Shows:
4:00 AM
7:30 AM

Book Now:
https://...

Timestamp:
2026-07-19T00:00:00.000Z
```

## Configuration

Use `.env`, `watcher.config.json`, or both. Environment variables override the JSON config.

| Variable | Default | Description |
| --- | --- | --- |
| `MOVIE_NAME` | `Jana Nayagan` | Target movie title. |
| `CITY` | `Chennai` | Target city. |
| `THEATRES_JSON` | priority Chennai theatre list | JSON array of theatre targets with `id`, `name`, `chain`, `providers`, and `priority`. |
| `THEATRES_FILE` | empty | Path to a JSON file containing the same theatre target array. |
| `THEATRES` | empty | Backward-compatible comma-separated theatre filters. If set, this overrides structured theatre config and has no provider/priority metadata. |
| `PROVIDERS` | `bookmyshow,district` | Enabled providers. |
| `POLL_INTERVAL` | `5m` | Poll interval for `--watch`. |
| `RUN_ONCE` | `true` | Run once and exit. Best for cron/GitHub Actions. |
| `NOTIFICATION_MODE` | `state-change` | `state-change` alerts once per `NOT_AVAILABLE` -> `AVAILABLE` transition. `while_available` alerts on every run while a theatre remains available. |
| `STATE_FILE` | `.watcher/state.json` | Persistent notification state. |
| `DISCOVERY_DIR` | `.watcher/discovery` | Network discovery diagnostics. |
| `BROWSER_FALLBACK` | `true` | Use Playwright network inspection when API config is missing or stale. |
| `PLAYWRIGHT_HEADLESS` | `true` | Browser mode for network fallback. |
| `PROVIDER_TIMEOUT_MS` | `30000` | Per-provider browser/navigation timeout. |
| `REQUEST_TIMEOUT_MS` | `15000` | Axios API request timeout. |
| `MIN_REQUEST_DELAY_MS` | `750` | Per-provider API request spacing. |
| `BOOKMYSHOW_API_ENDPOINTS` | empty | JSON endpoint configs or comma-separated GET URLs. |
| `DISTRICT_API_ENDPOINTS` | empty | JSON endpoint configs or comma-separated GET URLs. |
| `BOOKMYSHOW_START_URLS` | city listing page | Comma-separated pages used for Playwright network discovery. |
| `DISTRICT_START_URLS` | city listing page | Comma-separated pages used for Playwright network discovery. |
| `TELEGRAM_BOT_TOKEN` | empty | Telegram bot token. |
| `TELEGRAM_CHAT_ID` | empty | Telegram chat id. |
| `FAIL_ON_PROVIDER_ERROR` | `false` | Exit non-zero on provider errors. |
| `FAIL_ON_NOTIFICATION_ERROR` | `true` | Exit non-zero when Telegram delivery fails. |

Theatre target format:

```json
[
  {
    "id": "pvr-vr-chennai-anna-nagar",
    "name": "PVR: VR Chennai, Anna Nagar",
    "chain": "PVR",
    "providers": ["BookMyShow"],
    "priority": 1
  },
  {
    "id": "rakki-rgb-laser-4k-ambattur",
    "name": "Rakki RGB Laser 4K - Ambattur",
    "chain": "Rakki",
    "providers": ["District"],
    "priority": 1
  }
]
```

Provider names are normalized, so `BookMyShow`, `bookmyshow`, and `Book My Show` all map to `bookmyshow`. Lower `priority` values are checked and notified first. State keys use the theatre `id` when available, which avoids duplicate alerts caused by small provider naming changes.

API endpoint override examples:

```bash
BOOKMYSHOW_API_ENDPOINTS=https://example.com/api/movies?city=chennai
```

```bash
DISTRICT_API_ENDPOINTS='[
  {
    "method": "POST",
    "url": "https://example.com/graphql",
    "headers": {
      "content-type": "application/json"
    },
    "body": {
      "operationName": "ShowsByMovie",
      "variables": {
        "city": "chennai",
        "movie": "Jana Nayagan"
      }
    }
  }
]'
```

## API-First Discovery Workflow

Ticketing sites often use private APIs that change without notice. This project avoids hardcoding brittle endpoints into provider code.

Recommended workflow:

1. Run `npm run discover`.
2. Open `.watcher/discovery/bookmyshow-latest.json` and `.watcher/discovery/district-latest.json`.
3. Look for candidate URLs where the response preview includes the target movie, venue, show, or availability data.
4. Add the stable endpoint to `BOOKMYSHOW_API_ENDPOINTS` or `DISTRICT_API_ENDPOINTS`.
5. Run `npm run dev` and confirm the provider logs `apiSuccessCount`.

Routine polling will use Axios against configured endpoints. Playwright is only used when the configured API is absent, fails, or yields no recognizable availability records.

## Availability Basis

By default, the watcher sends an alert only when a configured theatre changes from `NOT_AVAILABLE` to `AVAILABLE`. Set `NOTIFICATION_MODE=while_available` to send on every run while a configured theatre remains available, stopping when it becomes sold out or unavailable.

Provider show statuses are interpreted as:

| Provider wording | Watcher meaning | Alert? |
| --- | --- | --- |
| `Available` | `AVAILABLE` | Yes |
| `Fast Filling` | `FAST_FILLING` | Yes |
| `Filling fast` | `FAST_FILLING` | Yes |
| `Almost Full` | `ALMOST_FULL` | Yes |
| `Sold Out` | `SOLD_OUT` | No |

The watcher does not treat generic SEO/page text or a theatre directory mention as availability. It requires structured JSON/network data with an explicit provider status, a bookable/open flag, or another clear provider-side booking signal.

For BookMyShow, when no usable JSON/XHR availability API is exposed to the watcher, the Playwright fallback reads the rendered theatre show chips. Chip colors are mapped conservatively: green is `Available`, yellow/orange is `Fast Filling`, red is `Almost Full`, and grey is `Sold Out`.

For District, the watcher first reads structured movie session data when available and treats a show as bookable only when the session is not disabled and exposes seat availability. District `seatStatus` text alone is not enough, because disabled grey chips can still carry labels like `Almost Full`. If structured data is unavailable, the Playwright fallback reads rendered show chips for configured District theatres; text colors are mapped from the legend: black is `Available`, yellow is `Filling fast`, orange/red is `Almost full`, and grey is `Sold Out`.

## GitHub Actions Deployment

The included workflow runs every 5 minutes:

```text
.github/workflows/check.yml
```

Required repository secrets:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

Optional repository variables:

- `MOVIE_NAME`
- `CITY`
- `THEATRES_JSON`
- `THEATRES_FILE`
- `THEATRES`
- `PROVIDERS`
- `BOOKMYSHOW_START_URLS`
- `DISTRICT_START_URLS`
- `BROWSER_FALLBACK`
- `LOG_LEVEL`

Optional repository secrets:

- `BOOKMYSHOW_API_ENDPOINTS`
- `DISTRICT_API_ENDPOINTS`

The workflow commits `.watcher/state.json` back to the repo so duplicate notification state survives scheduled runs. The file contains watcher state only, not Telegram secrets.

## Architecture

```text
src/
  config.ts                  Loads env/config JSON.
  index.ts                   CLI runner and notification state machine.
  types.ts                   Provider, notifier, config, and state contracts.
  providers/
    apiFirstProvider.ts       Shared API-first provider implementation.
    bookmyshow.ts             BookMyShow provider registration.
    district.ts               District provider registration.
  discovery/
    networkInspector.ts       Playwright XHR/fetch inspector.
    availabilityExtractor.ts  JSON response availability extractor.
    bookmyshowDomExtractor.ts BookMyShow rendered show-chip fallback.
    districtStructuredExtractor.ts District structured session extractor.
    districtDomExtractor.ts   District rendered show-chip fallback.
  notifier/
    telegram.ts               Telegram and console notification implementations.
  storage/
    state.ts                  Atomic JSON state persistence.
  utils/                      Logging, theatre matching, retry, rate limiting.
tests/                        Vitest unit tests.
```

To add a provider, implement `AvailabilityProvider` or extend `ApiFirstProvider`, then register it in `src/providers/index.ts`.

## Reliability Notes

- Prefer direct API endpoint configuration once discovered.
- Keep Playwright fallback enabled for provider endpoint drift.
- Use conservative polling; 5 minutes is reasonable for GitHub Actions.
- Do not store cookies or auth tokens in discovery artifacts.
- Watch provider logs for `jsonResponsesSeen`, `candidates`, and `apiSuccessCount`.
- Add provider-specific extractors when a private API response shape becomes stable.
- Consider a long-running deployment on a VPS, Fly.io, Render, or Railway for tighter polling than GitHub Actions can guarantee.
- Add Slack/Discord/Email by implementing the `Notifier` interface and adding it to `NotifierChain`.
# reserve-booking-watcher
