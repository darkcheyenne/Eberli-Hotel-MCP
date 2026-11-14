# Travel & Hotel Intelligence MCP Server

Unified private Model Context Protocol (MCP) server built in TypeScript (ESM, Node.js 22+) integrating three travel intelligence providers:

1. **China Travel (`china_*`)** — Native TypeScript port of `mako202605/china-travel-mcp` (TripGenie / Trip.com inventory & booking links).
2. **TripAdvisor Terra API (`ta_*`)** — Modernized partner content API (`https://terra.tripadvisor.com/api`) with defensive optional-field parsing and allowlist-aware `404` error handling.
3. **Google Places API (New) (`gplaces_*`)** — `https://places.googleapis.com/v1` with explicit `X-Goog-FieldMask` headers for SKU efficiency.
4. **Cross-Provider Comparison (`compare_hotel_intelligence`)** — Queries all active providers in parallel and normalizes ratings, review counts, and price levels onto unified scales (`0–5` & `0–100`).

---

## Setup & Scripts

```bash
npm install
cp .env.example .env
npm run build
npm test
```

### Running the Server

- **Stdio transport (default, for Claude Desktop / Cursor / IDE MCP clients):**
  ```bash
  npm start
  # or during development:
  npm run dev
  ```
- **Streamable HTTP transport (`/mcp` + `/health`):**
  ```bash
  npm run start:http
  # or:
  MCP_TRANSPORT=http PORT=3000 HOST=127.0.0.1 node dist/index.js
  ```

### Docker & GitHub Actions

Build and run locally with Docker (defaults to Streamable HTTP on port `3000`):

```bash
docker build -t eberli-hotel-mcp .
docker run --rm -p 3000:3000 \
  -e TRIPADVISOR_TERRA_API_KEY=... \
  -e GOOGLE_PLACES_API_KEY=... \
  eberli-hotel-mcp
```

Or using Docker Compose (reads variables from `.env`):

```bash
cp .env.example .env
# Set TRIPADVISOR_TERRA_API_KEY / GOOGLE_PLACES_API_KEY in .env
docker compose up -d
```

The GitHub Actions workflow in [.github/workflows/docker.yml](.github/workflows/docker.yml) automatically runs `typecheck`, `build`, and `test`, builds a multi-arch (`linux/amd64`, `linux/arm64`) Docker image on every push/PR, and pushes images to **GitHub Container Registry (`ghcr.io/<owner>/<repo>`)** on pushes to `main` or `v*` tags (and optionally to Docker Hub if `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` secrets are configured).

---

## Configuration (Environment Variables)

| Variable | Default | Description |
| :--- | :--- | :--- |
| `MCP_TRANSPORT` | `stdio` | Transport mode (`stdio` or `http`) |
| `HOST` | `127.0.0.1` | HTTP bind host (DNS rebinding protection enabled for localhost) |
| `PORT` | `3000` | HTTP port |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, or `error` (always written to `stderr`) |
| `CACHE_TTL_SECONDS` | `3600` | In-memory TTL cache duration (`0` disables caching) |
| `CACHE_MAX_ENTRIES` | `500` | Max cached entries before LRU eviction |
| `HTTP_TIMEOUT_MS` | `15000` | Default HTTP request timeout in ms |
| `HTTP_MAX_RETRIES` | `3` | Exponential backoff retries for `429` and `5xx` |
| `CHINA_TRAVEL_ENABLED` | `true` | Enable/disable `china_*` tools |
| `CHINA_TRAVEL_PROXY_TOKEN` | `tp_8k2mX9vQ4z` | Also falls back to `PROXY_TOKEN` |
| `TRIPADVISOR_TERRA_API_KEY` | *(optional)* | Omit to skip registering `ta_*` tools |
| `GOOGLE_PLACES_API_KEY` | *(optional)* | Omit to skip registering `gplaces_*` tools |

---

## Tools

### China Travel (`china_*`)
- `china_search_hotels`
- `china_search_flights`
- `china_search_attractions`
- `china_plan_itinerary`
- `china_get_travel_tips`

### TripAdvisor Terra (`ta_*`)
- `ta_search_locations` (allowlist-restricted)
- `ta_search_catalog` (full catalog ID discovery)
- `ta_get_location_details`
- `ta_get_location_reviews`
- `ta_get_location_photos`

### Google Places (New) (`gplaces_*`)
- `gplaces_search_text`
- `gplaces_search_nearby`
- `gplaces_get_place_details`
- `gplaces_get_place_photo`

### Cross-Provider Intelligence
- `compare_hotel_intelligence`
