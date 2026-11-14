import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TripAdvisorTerraProvider } from "../providers/tripadvisor-terra.js";
import { jsonToolResult, withToolErrorHandling } from "../utils/http.js";

const searchInputSchema = {
  query: z.string().trim().min(1).max(500).describe("Business name or address search text (1-500 chars)"),
  category: z
    .enum(["HOTEL", "RESTAURANT", "ATTRACTION"])
    .optional()
    .describe("Filter by TripAdvisor category"),
  search_type: z
    .enum(["NAME", "ADDRESS", "COMBINED"])
    .optional()
    .describe("Search matching mode (default: NAME)"),
  country_code: z.string().trim().min(2).max(3).optional().describe("ISO country code filter"),
  geo_name: z.string().trim().optional().describe("City/region geographic name filter"),
  postal_code: z.string().trim().optional().describe("Postal code filter"),
  locale: z.string().trim().optional().describe("Locale code for localized text fields (e.g. en, de)"),
  page: z.number().int().min(1).optional().describe("1-based page number"),
  size: z.number().int().min(1).max(50).optional().describe("Page size (1-50)"),
};

const locationIdSchema = z
  .union([z.string().trim().min(1), z.number().int().positive()])
  .describe("TripAdvisor Location ID");

/**
 * Registers all TripAdvisor Terra API MCP tools (ta_*).
 */
export function registerTripAdvisorTools(
  server: McpServer,
  provider: TripAdvisorTerraProvider,
): string[] {
  const registered: string[] = [];

  server.registerTool(
    "ta_search_locations",
    {
      title: "TripAdvisor Terra: Search Allowlisted Locations",
      description:
        "Search TripAdvisor Terra locations restricted to your account allowlist, returning full location metadata, ratings, and addresses.",
      inputSchema: searchInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    withToolErrorHandling("tripadvisor_terra", async (args) => {
      const result = await provider.searchLocations(args);
      return jsonToolResult({
        provider: "tripadvisor_terra",
        endpoint: "/locations/search",
        count: result.locations.length,
        cached: result.cached,
        pagination: result.pagination,
        locations: result.locations,
      });
    }),
  );
  registered.push("ta_search_locations");

  server.registerTool(
    "ta_search_catalog",
    {
      title: "TripAdvisor Terra: Search Full Catalog",
      description:
        "Search the full TripAdvisor catalog (unrestricted by allowlist) to discover and resolve Location IDs with lightweight summaries.",
      inputSchema: searchInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    withToolErrorHandling("tripadvisor_terra", async (args) => {
      const result = await provider.searchCatalog(args);
      return jsonToolResult({
        provider: "tripadvisor_terra",
        endpoint: "/catalog/locations/search",
        count: result.locations.length,
        cached: result.cached,
        pagination: result.pagination,
        locations: result.locations,
      });
    }),
  );
  registered.push("ta_search_catalog");

  server.registerTool(
    "ta_get_location_details",
    {
      title: "TripAdvisor Terra: Get Location Details",
      description:
        "Retrieve full details for a TripAdvisor Location ID (ratings, rankings, subratings, contact info, amenities). Returns a clear error if the ID is not on your Terra allowlist (HTTP 404).",
      inputSchema: {
        locationId: locationIdSchema,
        locale: z.string().trim().optional().describe("Optional locale code (e.g. en, de, zh)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    withToolErrorHandling("tripadvisor_terra", async (args) => {
      const result = await provider.getLocationDetails(args.locationId, args.locale);
      return jsonToolResult({
        provider: "tripadvisor_terra",
        endpoint: `/locations/${args.locationId}`,
        cached: result.cached,
        location: result.location,
      });
    }),
  );
  registered.push("ta_get_location_details");

  server.registerTool(
    "ta_get_location_reviews",
    {
      title: "TripAdvisor Terra: Get Location Reviews",
      description:
        "Retrieve traveler reviews and subratings for an allowlisted TripAdvisor Location ID with optional rating, trip type, date, language, and sort filters.",
      inputSchema: {
        locationId: locationIdSchema,
        rating_min: z.number().min(1).max(5).optional().describe("Minimum overall rating (1-5)"),
        trip_type: z
          .enum(["business", "couples", "family", "friends", "solo"])
          .optional()
          .describe("Filter by traveler trip type"),
        published_after_ts: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD date")
          .optional()
          .describe("Only reviews published on/after YYYY-MM-DD"),
        language: z.string().trim().optional().describe("Language filter code (e.g. en, de)"),
        sort_by: z
          .enum(["MOST_RECENT", "HIGHEST_RATED"])
          .optional()
          .describe("Review sort order"),
        published_after_review_id: z
          .string()
          .trim()
          .optional()
          .describe("Keyset pagination cursor review ID"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    withToolErrorHandling("tripadvisor_terra", async (args) => {
      const result = await provider.getLocationReviews(args);
      return jsonToolResult({
        provider: "tripadvisor_terra",
        endpoint: `/locations/${args.locationId}/reviews`,
        count: result.reviews.length,
        cached: result.cached,
        pagination: result.pagination,
        reviews: result.reviews,
      });
    }),
  );
  registered.push("ta_get_location_reviews");

  server.registerTool(
    "ta_get_location_photos",
    {
      title: "TripAdvisor Terra: Get Location Photos",
      description:
        "Retrieve photo URLs and metadata for an allowlisted TripAdvisor Location ID.",
      inputSchema: {
        locationId: locationIdSchema,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    withToolErrorHandling("tripadvisor_terra", async (args) => {
      const result = await provider.getLocationPhotos(args.locationId);
      return jsonToolResult({
        provider: "tripadvisor_terra",
        endpoint: `/locations/${args.locationId}/photos`,
        count: result.photos.length,
        cached: result.cached,
        pagination: result.pagination,
        photos: result.photos,
      });
    }),
  );
  registered.push("ta_get_location_photos");

  return registered;
}
