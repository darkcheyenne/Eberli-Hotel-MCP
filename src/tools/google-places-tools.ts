import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GooglePlacesProvider } from "../providers/google-places.js";
import { jsonToolResult, withToolErrorHandling } from "../utils/http.js";

/**
 * Registers all Google Places API (New) MCP tools (gplaces_*).
 */
export function registerGooglePlacesTools(
  server: McpServer,
  provider: GooglePlacesProvider,
): string[] {
  const registered: string[] = [];

  server.registerTool(
    "gplaces_search_text",
    {
      title: "Google Places (New): Text Search",
      description:
        "Search hotels, restaurants, and attractions via Google Places API (New) Text Search with ratings, price levels, coordinates, and editorial summaries.",
      inputSchema: {
        textQuery: z
          .string()
          .trim()
          .min(1)
          .describe('Free-text search query, e.g. "Park Hyatt Shanghai" or "boutique hotels in Zurich"'),
        includedType: z
          .string()
          .trim()
          .optional()
          .describe('Optional Google place type filter, e.g. "lodging", "hotel", "restaurant"'),
        languageCode: z.string().trim().optional().describe('BCP-47 language code, e.g. "en", "de"'),
        regionCode: z.string().trim().optional().describe('CLDR region code, e.g. "CH", "CN", "US"'),
        maxResultCount: z.number().int().min(1).max(20).default(10).describe("Max results (1-20)"),
        minRating: z.number().min(0).max(5).optional().describe("Minimum rating filter (0-5)"),
        priceLevels: z
          .array(
            z.enum([
              "PRICE_LEVEL_INEXPENSIVE",
              "PRICE_LEVEL_MODERATE",
              "PRICE_LEVEL_EXPENSIVE",
              "PRICE_LEVEL_VERY_EXPENSIVE",
            ]),
          )
          .optional()
          .describe("Optional price level filters"),
        latitude: z.number().min(-90).max(90).optional().describe("Optional bias center latitude"),
        longitude: z.number().min(-180).max(180).optional().describe("Optional bias center longitude"),
        radiusMeters: z
          .number()
          .positive()
          .max(50000)
          .optional()
          .describe("Optional location bias circle radius in meters (default 5000)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    withToolErrorHandling("google_places", async (args) => {
      const result = await provider.searchText(args);
      return jsonToolResult({
        provider: "google_places",
        endpoint: "/places:searchText",
        count: result.places.length,
        cached: result.cached,
        places: result.places,
      });
    }),
  );
  registered.push("gplaces_search_text");

  server.registerTool(
    "gplaces_search_nearby",
    {
      title: "Google Places (New): Nearby Search",
      description:
        "Search places within a geographic circle using Google Places API (New) Nearby Search.",
      inputSchema: {
        latitude: z.number().min(-90).max(90).describe("Circle center latitude"),
        longitude: z.number().min(-180).max(180).describe("Circle center longitude"),
        radiusMeters: z.number().positive().max(50000).describe("Search radius in meters (<= 50000)"),
        includedTypes: z
          .array(z.string().trim().min(1))
          .optional()
          .describe('Included Google place types, e.g. ["hotel", "lodging"]'),
        excludedTypes: z
          .array(z.string().trim().min(1))
          .optional()
          .describe("Excluded Google place types"),
        maxResultCount: z.number().int().min(1).max(20).default(10).describe("Max results (1-20)"),
        languageCode: z.string().trim().optional().describe("BCP-47 language code"),
        regionCode: z.string().trim().optional().describe("CLDR region code"),
        rankPreference: z
          .enum(["POPULARITY", "DISTANCE"])
          .optional()
          .describe("Result ranking preference"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    withToolErrorHandling("google_places", async (args) => {
      const result = await provider.searchNearby(args);
      return jsonToolResult({
        provider: "google_places",
        endpoint: "/places:searchNearby",
        count: result.places.length,
        cached: result.cached,
        places: result.places,
      });
    }),
  );
  registered.push("gplaces_search_nearby");

  server.registerTool(
    "gplaces_get_place_details",
    {
      title: "Google Places (New): Get Place Details",
      description:
        "Fetch detailed Google Place information including rating, userRatingCount, editorialSummary, opening hours, priceLevel, and optionally up to 5 relevant reviews and photo references.",
      inputSchema: {
        placeId: z
          .string()
          .trim()
          .min(1)
          .describe('Google Place ID (e.g. "ChIJ..." or "places/ChIJ...")'),
        languageCode: z.string().trim().optional().describe("BCP-47 language code"),
        regionCode: z.string().trim().optional().describe("CLDR region code"),
        includeReviews: z
          .boolean()
          .default(true)
          .describe("Include up to 5 Google user reviews (default: true)"),
        includePhotos: z
          .boolean()
          .default(false)
          .describe("Include photo resource names for gplaces_get_place_photo (default: false)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    withToolErrorHandling("google_places", async (args) => {
      const result = await provider.getPlaceDetails(args);
      return jsonToolResult({
        provider: "google_places",
        endpoint: `/places/${args.placeId.replace(/^places\//, "")}`,
        cached: result.cached,
        place: result.place,
      });
    }),
  );
  registered.push("gplaces_get_place_details");

  server.registerTool(
    "gplaces_get_place_photo",
    {
      title: "Google Places (New): Resolve Photo URL",
      description:
        "Resolve a Google Places photo resource name (from gplaces_get_place_details) into a direct CDN photoUri without downloading binary image data.",
      inputSchema: {
        photoName: z
          .string()
          .trim()
          .min(1)
          .describe('Photo resource name, e.g. "places/ChIJ.../photos/AX..."'),
        maxWidthPx: z.number().int().min(1).max(4800).optional().describe("Max width in pixels (1-4800)"),
        maxHeightPx: z.number().int().min(1).max(4800).optional().describe("Max height in pixels (1-4800)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    withToolErrorHandling("google_places", async (args) => {
      const result = await provider.getPlacePhotoUrl(args);
      return jsonToolResult({
        provider: "google_places",
        cached: result.cached,
        photo: {
          name: result.name,
          photoUri: result.photoUri,
        },
      });
    }),
  );
  registered.push("gplaces_get_place_photo");

  return registered;
}
