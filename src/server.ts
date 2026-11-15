import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig, Logger } from "./config.js";
import { createLogger } from "./config.js";
import { ChinaTravelProvider } from "./providers/china-travel.js";
import { GooglePlacesProvider } from "./providers/google-places.js";
import { TripAdvisorTerraProvider } from "./providers/tripadvisor-terra.js";
import { type ProviderRegistry, registerAggregateTools } from "./tools/aggregate-tools.js";
import { registerChinaTools } from "./tools/china-tools.js";
import { registerGooglePlacesTools } from "./tools/google-places-tools.js";
import { registerTripAdvisorTools } from "./tools/tripadvisor-tools.js";
import { TtlCache } from "./utils/cache.js";

export const SERVER_NAME = "travel-hotel-intelligence-mcp";
export const SERVER_VERSION = "1.1.0";

export interface CreateServerOptions {
  config: AppConfig;
  logger?: Logger;
  cache?: TtlCache<unknown>;
  fetchImpl?: typeof fetch;
}

export interface CreatedTravelMcpServer {
  server: McpServer;
  cache: TtlCache<unknown>;
  providers: ProviderRegistry;
  enabledProviders: string[];
  registeredTools: string[];
}

/**
 * Instantiates the unified McpServer and gracefully registers only providers
 * whose required credentials/flags are present.
 */
export function createTravelMcpServer(options: CreateServerOptions): CreatedTravelMcpServer {
  const { config, fetchImpl } = options;
  const logger = options.logger ?? createLogger(config.logLevel);
  const cache =
    options.cache ??
    new TtlCache<unknown>({
      ttlSeconds: config.cacheTtlSeconds,
      staleTtlSeconds: config.cacheStaleTtlSeconds,
      maxEntries: config.cacheMaxEntries,
      persistFilePath: config.cachePersistPath,
    });

  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  const providers: ProviderRegistry = { cache };
  const enabledProviders: string[] = [];
  const registeredTools: string[] = [];

  // 1. China Travel (mako202605/china-travel-mcp native TS port)
  if (config.chinaTravel.enabled) {
    const chinaTravel = ChinaTravelProvider.fromConfig(config, cache, fetchImpl);
    providers.chinaTravel = chinaTravel;
    enabledProviders.push("china_travel");
    const tools = registerChinaTools(server, chinaTravel);
    registeredTools.push(...tools);
    logger.info("Registered China Travel provider", { toolsCount: tools.length });
  } else {
    logger.warn("China Travel provider disabled via CHINA_TRAVEL_ENABLED=false; skipping china_* tools.");
  }

  // 2. TripAdvisor Terra API (optional key)
  const tripadvisorTerra = TripAdvisorTerraProvider.fromConfig(config, cache, fetchImpl);
  if (tripadvisorTerra) {
    providers.tripadvisorTerra = tripadvisorTerra;
    enabledProviders.push("tripadvisor_terra");
    const tools = registerTripAdvisorTools(server, tripadvisorTerra, providers.chinaTravel);
    registeredTools.push(...tools);
    logger.info("Registered TripAdvisor Terra provider", { toolsCount: tools.length });
  } else {
    logger.warn(
      "TRIPADVISOR_TERRA_API_KEY is not configured; skipping TripAdvisor Terra tools (ta_*).",
    );
  }

  // 3. Google Places API (New) (optional key)
  const googlePlaces = GooglePlacesProvider.fromConfig(config, cache, fetchImpl);
  if (googlePlaces) {
    providers.googlePlaces = googlePlaces;
    enabledProviders.push("google_places");
    const tools = registerGooglePlacesTools(server, googlePlaces);
    registeredTools.push(...tools);
    logger.info("Registered Google Places (New) provider", { toolsCount: tools.length });
  } else {
    logger.warn(
      "GOOGLE_PLACES_API_KEY is not configured; skipping Google Places tools (gplaces_*).",
    );
  }

  // 4. Cross-provider comparison & rating normalization tool
  if (enabledProviders.length > 0) {
    const aggTools = registerAggregateTools(server, providers);
    registeredTools.push(...aggTools);
  } else {
    logger.warn("No travel data providers are enabled; compare_hotel_intelligence was not registered.");
  }

  logger.info("MCP server initialized", {
    enabledProviders,
    registeredToolsCount: registeredTools.length,
    cacheTtlSeconds: config.cacheTtlSeconds,
  });

  return {
    server,
    cache,
    providers,
    enabledProviders,
    registeredTools,
  };
}
