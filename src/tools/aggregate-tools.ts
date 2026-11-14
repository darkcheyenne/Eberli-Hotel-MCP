import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ChinaTravelProvider } from "../providers/china-travel.js";
import type { GooglePlacesProvider } from "../providers/google-places.js";
import type { TripAdvisorTerraProvider } from "../providers/tripadvisor-terra.js";
import {
  HttpError,
  formatProviderError,
  jsonToolResult,
  withToolErrorHandling,
} from "../utils/http.js";
import {
  type NormalizedRating,
  computeConsensusRating,
  parseChinaTravelHighlights,
} from "../utils/normalizer.js";

export interface ProviderRegistry {
  chinaTravel?: ChinaTravelProvider;
  tripadvisorTerra?: TripAdvisorTerraProvider;
  googlePlaces?: GooglePlacesProvider;
}

type ProviderSectionStatus = "ok" | "skipped" | "not_found" | "not_allowlisted" | "error";

async function queryTripAdvisorComparison(
  provider: TripAdvisorTerraProvider | undefined,
  params: {
    hotelName: string;
    city: string;
    tripadvisorLocationId?: string;
    includeReviews: boolean;
  },
): Promise<{ status: ProviderSectionStatus; rating?: NormalizedRating; data: Record<string, unknown> }> {
  if (!provider) {
    return {
      status: "skipped",
      data: { reason: "TRIPADVISOR_TERRA_API_KEY is not configured." },
    };
  }

  let catalogFallbackMatch: Record<string, unknown> | undefined;

  try {
    let locationId = params.tripadvisorLocationId;

    if (!locationId) {
      const allowlistSearch = await provider.searchLocations({
        query: `${params.hotelName} ${params.city}`,
        category: "HOTEL",
        size: 3,
      });

      const topAllowlisted = allowlistSearch.locations[0];
      if (topAllowlisted && topAllowlisted.locationId !== "unknown") {
        locationId = topAllowlisted.locationId;
      } else {
        const catalogSearch = await provider.searchCatalog({
          query: `${params.hotelName} ${params.city}`,
          category: "HOTEL",
          size: 3,
        });
        const topCatalog = catalogSearch.locations[0];
        if (!topCatalog || topCatalog.locationId === "unknown") {
          return {
            status: "not_found",
            data: { message: `No matching TripAdvisor hotel found for "${params.hotelName}" in ${params.city}.` },
          };
        }
        locationId = topCatalog.locationId;
        catalogFallbackMatch = {
          locationId: topCatalog.locationId,
          name: topCatalog.name,
          address: topCatalog.address,
          webUrl: topCatalog.webUrl,
        };
      }
    }

    const details = await provider.getLocationDetails(locationId);
    const reviews = params.includeReviews
      ? await provider.getLocationReviews({ locationId, sort_by: "MOST_RECENT" }).catch(() => undefined)
      : undefined;

    return {
      status: "ok",
      rating: details.location.rating,
      data: {
        location: details.location,
        reviews: reviews?.reviews.slice(0, 5),
      },
    };
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      return {
        status: "not_allowlisted",
        data: {
          message: error.message,
          actionableHint: error.actionableHint,
          ...(catalogFallbackMatch ? { catalogMatch: catalogFallbackMatch } : {}),
        },
      };
    }
    return {
      status: "error",
      data: { ...formatProviderError(error, "tripadvisor_terra") },
    };
  }
}

async function queryGooglePlacesComparison(
  provider: GooglePlacesProvider | undefined,
  params: {
    hotelName: string;
    city: string;
    country?: string;
    googlePlaceId?: string;
    includeReviews: boolean;
  },
): Promise<{ status: ProviderSectionStatus; rating?: NormalizedRating; data: Record<string, unknown> }> {
  if (!provider) {
    return {
      status: "skipped",
      data: { reason: "GOOGLE_PLACES_API_KEY is not configured." },
    };
  }

  try {
    let placeId = params.googlePlaceId;

    if (!placeId) {
      const textQuery = [params.hotelName, params.city, params.country].filter(Boolean).join(", ");
      const search = await provider.searchText({
        textQuery,
        includedType: "lodging",
        maxResultCount: 3,
      });

      const topPlace = search.places[0];
      if (!topPlace) {
        return {
          status: "not_found",
          data: { message: `No matching Google Place found for "${textQuery}".` },
        };
      }

      if (!params.includeReviews) {
        return {
          status: "ok",
          rating: topPlace.rating,
          data: { place: topPlace },
        };
      }

      placeId = topPlace.placeId;
    }

    const details = await provider.getPlaceDetails({
      placeId,
      includeReviews: params.includeReviews,
    });

    return {
      status: "ok",
      rating: details.place.rating,
      data: {
        place: details.place,
      },
    };
  } catch (error) {
    return {
      status: "error",
      data: { ...formatProviderError(error, "google_places") },
    };
  }
}

async function queryChinaTravelComparison(
  provider: ChinaTravelProvider | undefined,
  params: {
    hotelName: string;
    city: string;
    check_in?: string;
    check_out?: string;
    guests: number;
    includeChinaTravel: boolean;
  },
): Promise<{ status: ProviderSectionStatus; data: Record<string, unknown> }> {
  if (!provider) {
    return {
      status: "skipped",
      data: { reason: "China Travel provider is disabled." },
    };
  }
  if (!params.includeChinaTravel) {
    return {
      status: "skipped",
      data: { reason: "Skipped by caller (includeChinaTravel=false)." },
    };
  }

  try {
    const result = await provider.searchHotels({
      city: params.city,
      check_in: params.check_in,
      check_out: params.check_out,
      guests: params.guests,
      preferences: params.hotelName,
    });
    const highlights = parseChinaTravelHighlights(result.content);
    return {
      status: "ok",
      data: {
        query: result.query,
        cached: result.cached,
        highlights,
        summaryText: result.content,
      },
    };
  } catch (error) {
    return {
      status: "error",
      data: { ...formatProviderError(error, "china_travel") },
    };
  }
}

/**
 * Registers the cross-provider hotel comparison and normalization tool.
 */
export function registerAggregateTools(server: McpServer, providers: ProviderRegistry): string[] {
  const registered: string[] = [];

  server.registerTool(
    "compare_hotel_intelligence",
    {
      title: "Compare Hotel Intelligence Across Providers",
      description:
        "Query all configured travel intelligence providers (TripAdvisor Terra, Google Places New, China Travel/Trip.com) in parallel for a hotel, normalize ratings/prices/reviews onto unified scales (0-5 & 0-100), and compute a review-weighted consensus score.",
      inputSchema: {
        hotelName: z.string().trim().min(1).describe('Hotel name, e.g. "The Peninsula Shanghai"'),
        city: z.string().trim().min(1).describe('City name, e.g. "Shanghai"'),
        country: z.string().trim().optional().describe('Optional country name or code, e.g. "China"'),
        check_in: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
          .optional()
          .describe("Optional check-in date for China Travel pricing (YYYY-MM-DD)"),
        check_out: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
          .optional()
          .describe("Optional check-out date for China Travel pricing (YYYY-MM-DD)"),
        guests: z.number().int().min(1).max(20).default(2).describe("Number of guests (default: 2)"),
        tripadvisorLocationId: z
          .string()
          .trim()
          .optional()
          .describe("Optional known TripAdvisor Location ID to bypass search"),
        googlePlaceId: z
          .string()
          .trim()
          .optional()
          .describe("Optional known Google Place ID to bypass search"),
        includeReviews: z
          .boolean()
          .default(true)
          .describe("Fetch sample traveler reviews from TripAdvisor & Google Places (default: true)"),
        includeChinaTravel: z
          .boolean()
          .default(true)
          .describe("Query China Travel / Trip.com intelligence (set false for non-China hotels)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    withToolErrorHandling("system", async (args) => {
      const [taResult, gpResult, ctResult] = await Promise.all([
        queryTripAdvisorComparison(providers.tripadvisorTerra, {
          hotelName: args.hotelName,
          city: args.city,
          tripadvisorLocationId: args.tripadvisorLocationId,
          includeReviews: args.includeReviews,
        }),
        queryGooglePlacesComparison(providers.googlePlaces, {
          hotelName: args.hotelName,
          city: args.city,
          country: args.country,
          googlePlaceId: args.googlePlaceId,
          includeReviews: args.includeReviews,
        }),
        queryChinaTravelComparison(providers.chinaTravel, {
          hotelName: args.hotelName,
          city: args.city,
          check_in: args.check_in,
          check_out: args.check_out,
          guests: args.guests,
          includeChinaTravel: args.includeChinaTravel,
        }),
      ]);

      const structuredRatings: NormalizedRating[] = [];
      if (taResult.rating) structuredRatings.push(taResult.rating);
      if (gpResult.rating) structuredRatings.push(gpResult.rating);

      const consensus = computeConsensusRating(structuredRatings);

      return jsonToolResult({
        query: {
          hotelName: args.hotelName,
          city: args.city,
          country: args.country,
        },
        consensus: consensus ?? null,
        normalizedRatings: structuredRatings,
        providers: {
          tripadvisorTerra: { status: taResult.status, ...taResult.data },
          googlePlaces: { status: gpResult.status, ...gpResult.data },
          chinaTravel: { status: ctResult.status, ...ctResult.data },
        },
      });
    }),
  );
  registered.push("compare_hotel_intelligence");

  return registered;
}
