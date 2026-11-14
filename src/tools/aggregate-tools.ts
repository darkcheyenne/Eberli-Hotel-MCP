import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ChinaTravelProvider } from "../providers/china-travel.js";
import type { GoogleParsedPlace, GooglePlacesProvider } from "../providers/google-places.js";
import type {
  TerraParsedLocation,
  TripAdvisorTerraProvider,
} from "../providers/tripadvisor-terra.js";
import {
  type CriteriaThresholds,
  type HotelCandidateMatch,
  analyzeReviewsAndTopics,
  computeProviderDivergence,
  evaluateHotelCriteriaChecklist,
  resolveHotelIntelligence,
  scoreHotelCandidate,
} from "../utils/hotel-intelligence.js";
import {
  HttpError,
  formatProviderError,
  jsonToolResult,
  withToolErrorHandling,
} from "../utils/http.js";
import {
  type NormalizedRating,
  type NormalizedReview,
  computeConsensusRating,
  parseChinaTravelHighlights,
} from "../utils/normalizer.js";
import { normalizeTerraReviewLanguage } from "./tripadvisor-tools.js";

export interface ProviderRegistry {
  chinaTravel?: ChinaTravelProvider;
  tripadvisorTerra?: TripAdvisorTerraProvider;
  googlePlaces?: GooglePlacesProvider;
}

type ProviderSectionStatus = "ok" | "skipped" | "not_found" | "not_allowlisted" | "error";

const criteriaSchema = z
  .object({
    maxPriceUsd: z.number().positive().optional().describe("Max nightly price in USD (default: 500)"),
    minTripComRatingOutOf10: z
      .number()
      .min(0)
      .max(10)
      .optional()
      .describe("Minimum Trip.com rating out of 10 (default: 9.3)"),
    minRatingOutOf5: z
      .number()
      .min(0)
      .max(5)
      .optional()
      .describe("Fallback minimum consensus rating out of 5 (default: 4.5)"),
    requireNonSmokingRoom: z.boolean().optional(),
    require24hSmokingArea: z.boolean().optional(),
    requireWesternBreakfast: z.boolean().optional(),
    requireLaundry: z.boolean().optional(),
    requireHeatedIndoorPool: z.boolean().optional(),
  })
  .optional()
  .describe("Optional custom thresholds for the 5 hotel criteria");

async function queryTripAdvisorComparison(
  provider: TripAdvisorTerraProvider | undefined,
  params: {
    hotelName: string;
    city: string;
    tripadvisorLocationId?: string;
    includeReviews: boolean;
    language?: string;
  },
): Promise<{
  status: ProviderSectionStatus;
  rating?: NormalizedRating;
  location?: TerraParsedLocation;
  reviews?: NormalizedReview[];
  candidates: HotelCandidateMatch[];
  data: Record<string, unknown>;
}> {
  if (!provider) {
    return {
      status: "skipped",
      candidates: [],
      data: { reason: "TRIPADVISOR_TERRA_API_KEY is not configured." },
    };
  }

  let catalogFallbackLocation: TerraParsedLocation | undefined;
  let catalogFallbackMatch: Record<string, unknown> | undefined;
  const candidates: HotelCandidateMatch[] = [];

  const taQuery = params.hotelName.toLowerCase().includes(params.city.toLowerCase())
    ? params.hotelName
    : `${params.hotelName} ${params.city}`;

  try {
    let locationId = params.tripadvisorLocationId;

    if (!locationId) {
      const allowlistSearch = await provider.searchLocations({
        query: taQuery,
        category: "HOTEL",
        size: 5,
      });

      const scoredAllowlist = allowlistSearch.locations
        .filter((loc) => loc.locationId !== "unknown")
        .map((loc) => ({
          loc,
          confidence: scoreHotelCandidate(params.hotelName, params.city, {
            name: loc.name,
            city: loc.city,
            address: loc.address,
            reviewCount: loc.rating?.reviewCount,
          }),
        }))
        .sort((a, b) => b.confidence - a.confidence);

      for (const item of scoredAllowlist) {
        candidates.push({
          provider: "tripadvisor_terra",
          id: item.loc.locationId,
          name: item.loc.name,
          city: item.loc.city,
          country: item.loc.country,
          address: item.loc.address,
          ratingOutOf5: item.loc.rating?.normalizedOutOf5,
          reviewCount: item.loc.rating?.reviewCount,
          matchConfidence: item.confidence,
        });
      }

      const topAllowlisted = scoredAllowlist[0]?.loc;
      if (topAllowlisted) {
        locationId = topAllowlisted.locationId;
      } else {
        const catalogSearch = await provider.searchCatalog({
          query: taQuery,
          category: "HOTEL",
          size: 5,
        });

        const scoredCatalog = catalogSearch.locations
          .filter((loc) => loc.locationId !== "unknown")
          .map((loc) => ({
            loc,
            confidence: scoreHotelCandidate(params.hotelName, params.city, {
              name: loc.name,
              city: loc.city,
              address: loc.address,
              reviewCount: loc.rating?.reviewCount,
            }),
          }))
          .sort((a, b) => b.confidence - a.confidence);

        for (const item of scoredCatalog) {
          candidates.push({
            provider: "tripadvisor_terra",
            id: item.loc.locationId,
            name: item.loc.name,
            city: item.loc.city,
            country: item.loc.country,
            address: item.loc.address,
            ratingOutOf5: item.loc.rating?.normalizedOutOf5,
            reviewCount: item.loc.rating?.reviewCount,
            matchConfidence: item.confidence,
          });
        }

        const topCatalog = scoredCatalog[0]?.loc;
        if (!topCatalog) {
          return {
            status: "not_found",
            candidates,
            data: {
              message: `No matching TripAdvisor hotel found for "${params.hotelName}" in ${params.city}.`,
            },
          };
        }
        locationId = topCatalog.locationId;
        catalogFallbackLocation = topCatalog;
        catalogFallbackMatch = {
          locationId: topCatalog.locationId,
          name: topCatalog.name,
          address: topCatalog.address,
          webUrl: topCatalog.webUrl,
          rating: topCatalog.rating,
        };
      }
    }

    const details = await provider.getLocationDetails(locationId);
    let reviews: NormalizedReview[] | undefined;

    if (params.includeReviews) {
      const reviewLang = normalizeTerraReviewLanguage(params.language);
      const revResult = await provider
        .getLocationReviews({
          locationId,
          language: reviewLang,
          sort_by: "MOST_RECENT",
        })
        .catch(() => undefined);

      reviews = revResult?.reviews;
      if ((!reviews || reviews.length === 0) && reviewLang) {
        const fallbackRev = await provider
          .getLocationReviews({
            locationId,
            sort_by: "MOST_RECENT",
          })
          .catch(() => undefined);
        reviews = fallbackRev?.reviews;
      }
    }

    if (candidates.length === 0) {
      candidates.push({
        provider: "tripadvisor_terra",
        id: details.location.locationId,
        name: details.location.name,
        city: details.location.city,
        country: details.location.country,
        address: details.location.address,
        ratingOutOf5: details.location.rating?.normalizedOutOf5,
        reviewCount: details.location.rating?.reviewCount,
        matchConfidence: scoreHotelCandidate(params.hotelName, params.city, {
          name: details.location.name,
          city: details.location.city,
          address: details.location.address,
          reviewCount: details.location.rating?.reviewCount,
        }),
      });
    }

    return {
      status: "ok",
      rating: details.location.rating,
      location: details.location,
      reviews: reviews?.slice(0, 5),
      candidates,
      data: {
        location: details.location,
        reviews: reviews?.slice(0, 5),
      },
    };
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      return {
        status: "not_allowlisted",
        rating: catalogFallbackLocation?.rating,
        location: catalogFallbackLocation,
        candidates,
        data: {
          message: error.message,
          actionableHint: error.actionableHint,
          ...(catalogFallbackLocation ? { location: catalogFallbackLocation } : {}),
          ...(catalogFallbackMatch ? { catalogMatch: catalogFallbackMatch } : {}),
        },
      };
    }
    return {
      status: "error",
      candidates,
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
    language?: string;
  },
): Promise<{
  status: ProviderSectionStatus;
  rating?: NormalizedRating;
  place?: GoogleParsedPlace;
  candidates: HotelCandidateMatch[];
  data: Record<string, unknown>;
}> {
  if (!provider) {
    return {
      status: "skipped",
      candidates: [],
      data: { reason: "GOOGLE_PLACES_API_KEY is not configured." },
    };
  }

  const candidates: HotelCandidateMatch[] = [];

  try {
    let placeId = params.googlePlaceId;

    if (!placeId) {
      const textQuery = [params.hotelName, params.city, params.country].filter(Boolean).join(", ");
      const search = await provider.searchText({
        textQuery,
        includedType: "lodging",
        languageCode: params.language,
        maxResultCount: 5,
      });

      const scoredPlaces = search.places
        .map((place) => ({
          place,
          confidence: scoreHotelCandidate(params.hotelName, params.city, {
            name: place.name,
            address: place.address,
            reviewCount: place.rating?.reviewCount,
          }),
        }))
        .sort((a, b) => b.confidence - a.confidence);

      for (const item of scoredPlaces) {
        candidates.push({
          provider: "google_places",
          id: item.place.placeId,
          name: item.place.name,
          address: item.place.address,
          ratingOutOf5: item.place.rating?.normalizedOutOf5,
          reviewCount: item.place.rating?.reviewCount,
          matchConfidence: item.confidence,
        });
      }

      const topPlace = scoredPlaces[0]?.place;
      if (!topPlace) {
        return {
          status: "not_found",
          candidates,
          data: { message: `No matching Google Place found for "${textQuery}".` },
        };
      }

      if (!params.includeReviews) {
        return {
          status: "ok",
          rating: topPlace.rating,
          place: topPlace,
          candidates,
          data: { place: topPlace },
        };
      }

      placeId = topPlace.placeId;
    }

    const details = await provider.getPlaceDetails({
      placeId,
      languageCode: params.language,
      includeReviews: params.includeReviews,
    });

    if (candidates.length === 0) {
      candidates.push({
        provider: "google_places",
        id: details.place.placeId,
        name: details.place.name,
        address: details.place.address,
        ratingOutOf5: details.place.rating?.normalizedOutOf5,
        reviewCount: details.place.rating?.reviewCount,
        matchConfidence: scoreHotelCandidate(params.hotelName, params.city, {
          name: details.place.name,
          address: details.place.address,
          reviewCount: details.place.rating?.reviewCount,
        }),
      });
    }

    return {
      status: "ok",
      rating: details.place.rating,
      place: details.place,
      candidates,
      data: {
        place: details.place,
      },
    };
  } catch (error) {
    return {
      status: "error",
      candidates,
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
    language?: string;
  },
): Promise<{ status: ProviderSectionStatus; summaryText?: string; data: Record<string, unknown> }> {
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
      locale: params.language,
    });
    const highlights = parseChinaTravelHighlights(result.content);
    return {
      status: "ok",
      summaryText: result.content,
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

export async function runSingleHotelComparison(
  providers: ProviderRegistry,
  args: {
    hotelName: string;
    city: string;
    country?: string;
    check_in?: string;
    check_out?: string;
    guests: number;
    tripadvisorLocationId?: string;
    googlePlaceId?: string;
    includeReviews: boolean;
    includeChinaTravel: boolean;
    language?: string;
    criteria?: CriteriaThresholds;
  },
) {
  const [taResult, gpResult, ctResult] = await Promise.all([
    queryTripAdvisorComparison(providers.tripadvisorTerra, {
      hotelName: args.hotelName,
      city: args.city,
      tripadvisorLocationId: args.tripadvisorLocationId,
      includeReviews: args.includeReviews,
      language: args.language,
    }),
    queryGooglePlacesComparison(providers.googlePlaces, {
      hotelName: args.hotelName,
      city: args.city,
      country: args.country,
      googlePlaceId: args.googlePlaceId,
      includeReviews: args.includeReviews,
      language: args.language,
    }),
    queryChinaTravelComparison(providers.chinaTravel, {
      hotelName: args.hotelName,
      city: args.city,
      check_in: args.check_in,
      check_out: args.check_out,
      guests: args.guests,
      includeChinaTravel: args.includeChinaTravel,
      language: args.language,
    }),
  ]);

  const structuredRatings: NormalizedRating[] = [];
  if (taResult.rating) structuredRatings.push(taResult.rating);
  if (gpResult.rating) structuredRatings.push(gpResult.rating);

  const consensus = computeConsensusRating(structuredRatings);

  const intel = await resolveHotelIntelligence({
    hotelName: args.hotelName,
    city: args.city,
    country: args.country,
    locationId: taResult.location?.locationId ?? args.tripadvisorLocationId,
    placeId: gpResult.place?.placeId ?? args.googlePlaceId,
    checkIn: args.check_in,
    checkOut: args.check_out,
    taLocation: taResult.location,
    taReviews: taResult.reviews,
    gpPlace: gpResult.place,
    chinaTravelText: ctResult.summaryText,
    chinaTravelProvider: providers.chinaTravel,
  });

  // Update provider objects with resolved priceTier and amenities
  if (taResult.location) {
    taResult.data.location = {
      ...taResult.location,
      priceTier: intel.resolvedPriceTier,
      amenities: intel.amenities,
      sources: intel.sources,
      pricing: intel.pricing,
    };
  }
  if (gpResult.place) {
    gpResult.data.place = {
      ...gpResult.place,
      priceTier:
        gpResult.place.priceTier !== "unknown"
          ? gpResult.place.priceTier
          : intel.resolvedPriceTier,
    };
  }

  const allCandidates = [...taResult.candidates, ...gpResult.candidates].sort(
    (a, b) => b.matchConfidence - a.matchConfidence,
  );
  const topConfidence = allCandidates[0]?.matchConfidence ?? 0;
  const taCandidates = taResult.candidates;
  const ambiguous =
    taCandidates.length > 1 &&
    Math.abs((taCandidates[0]?.matchConfidence ?? 0) - (taCandidates[1]?.matchConfidence ?? 0)) <
      0.15;

  const divergence = computeProviderDivergence(structuredRatings, intel.tripComRatingOutOf10);

  const allReviews: NormalizedReview[] = [
    ...(taResult.reviews ?? []),
    ...(gpResult.place?.reviews ?? []),
  ];
  const reviewAnalysis = analyzeReviewsAndTopics({
    reviews: allReviews,
    locationId: taResult.location?.locationId ?? args.tripadvisorLocationId,
    hotelName: args.hotelName,
    language: args.language,
    supplementWithCurated: true,
  });

  const criteriaEvaluation = evaluateHotelCriteriaChecklist({
    amenities: intel.amenities,
    pricing: intel.pricing,
    tripComRatingOutOf10: intel.tripComRatingOutOf10,
    consensusScoreOutOf5: consensus?.scoreOutOf5 ?? null,
    subratings: taResult.location?.subratings,
    topicStats: reviewAnalysis.topicStats,
    thresholds: args.criteria,
  });

  const resolvedName =
    taResult.location?.name ?? gpResult.place?.name ?? args.hotelName;

  return {
    query: {
      hotelName: args.hotelName,
      city: args.city,
      country: args.country,
      language: args.language ?? "en",
    },
    resolvedName,
    matchConfidence: topConfidence,
    ambiguous,
    candidates: allCandidates,
    consensus: consensus ?? null,
    providerDivergence: divergence.divergent,
    providerDivergenceDetails: divergence,
    normalizedRatings: structuredRatings,
    tripComRatingOutOf10: intel.tripComRatingOutOf10,
    tripComReviewCount: intel.tripComReviewCount,
    pricing: intel.pricing,
    priceTier: intel.resolvedPriceTier,
    amenities: intel.amenities,
    sources: intel.sources,
    topicStats: reviewAnalysis.topicStats,
    criteriaEvaluation,
    providers: {
      tripadvisorTerra: { status: taResult.status, ...taResult.data },
      googlePlaces: { status: gpResult.status, ...gpResult.data },
      chinaTravel: { status: ctResult.status, ...ctResult.data },
    },
  };
}

/**
 * Registers cross-provider hotel comparison, criteria evaluation, and batch comparison tools.
 */
export function registerAggregateTools(server: McpServer, providers: ProviderRegistry): string[] {
  const registered: string[] = [];

  server.registerTool(
    "compare_hotel_intelligence",
    {
      title: "Compare Hotel Intelligence Across Providers",
      description:
        "Query all configured travel intelligence providers (TripAdvisor Terra, Google Places New, China Travel/Trip.com) in parallel for a hotel, returning normalized ratings, providerDivergence flag, candidate matchConfidence, structured amenities (smoking, pool, laundry, breakfast), pricing in USD, topicStats, and 5-criteria evaluation.",
      inputSchema: {
        hotelName: z.string().trim().min(1).describe('Hotel name, e.g. "Futian Shangri-La, Shenzhen"'),
        city: z.string().trim().min(1).describe('City name, e.g. "Shenzhen"'),
        country: z.string().trim().optional().describe('Optional country name or code, e.g. "China"'),
        language: z
          .string()
          .trim()
          .default("en")
          .optional()
          .describe('Preferred language code for details and reviews (e.g. "de", "en", "zh")'),
        check_in: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
          .optional()
          .describe("Optional check-in date for pricing (YYYY-MM-DD)"),
        check_out: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
          .optional()
          .describe("Optional check-out date for pricing (YYYY-MM-DD)"),
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
          .describe("Query China Travel / Trip.com intelligence (default: true)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    withToolErrorHandling("system", async (args) => {
      const payload = await runSingleHotelComparison(providers, {
        ...args,
        guests: args.guests ?? 2,
        includeReviews: args.includeReviews ?? true,
        includeChinaTravel: args.includeChinaTravel ?? true,
      });
      return jsonToolResult(payload);
    }),
  );
  registered.push("compare_hotel_intelligence");

  server.registerTool(
    "evaluate_hotel_criteria",
    {
      title: "Evaluate Hotel Against 5 Mandatory Checklist Criteria",
      description:
        "Evaluate a hotel against the 5 travel-hotel-planning checklist criteria (1. Budget <=500 USD & >=9.3/10 rating, 2. Non-smoking room + 24/7 smoking area, 3. Genuine Western breakfast, 4. Reliable laundry solution, 5. Heated indoor pool & location) with pass/fail/unknown verdicts, evidence, and confidence.",
      inputSchema: {
        hotelName: z.string().trim().min(1).describe('Hotel name, e.g. "Futian Shangri-La, Shenzhen"'),
        city: z.string().trim().min(1).describe('City name, e.g. "Shenzhen"'),
        country: z.string().trim().optional().describe('Optional country name, e.g. "China"'),
        language: z
          .string()
          .trim()
          .default("de")
          .optional()
          .describe('Preferred language for review evidence (default: "de")'),
        check_in: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
          .optional()
          .describe("Optional check-in date (YYYY-MM-DD)"),
        check_out: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
          .optional()
          .describe("Optional check-out date (YYYY-MM-DD)"),
        tripadvisorLocationId: z.string().trim().optional(),
        googlePlaceId: z.string().trim().optional(),
        criteria: criteriaSchema,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    withToolErrorHandling("system", async (args) => {
      const full = await runSingleHotelComparison(providers, {
        hotelName: args.hotelName,
        city: args.city,
        country: args.country,
        check_in: args.check_in,
        check_out: args.check_out,
        guests: 2,
        tripadvisorLocationId: args.tripadvisorLocationId,
        googlePlaceId: args.googlePlaceId,
        includeReviews: true,
        includeChinaTravel: true,
        language: args.language ?? "de",
        criteria: args.criteria,
      });

      return jsonToolResult({
        hotelName: args.hotelName,
        resolvedName: full.resolvedName,
        city: args.city,
        country: args.country ?? null,
        matchConfidence: full.matchConfidence,
        ambiguous: full.ambiguous,
        candidates: full.candidates,
        overallVerdict: full.criteriaEvaluation.overallVerdict,
        passedCount: full.criteriaEvaluation.passedCount,
        failedCount: full.criteriaEvaluation.failedCount,
        unknownCount: full.criteriaEvaluation.unknownCount,
        criteria: full.criteriaEvaluation.criteria,
        pricing: full.pricing,
        amenities: full.amenities,
        sources: full.sources,
        tripComRatingOutOf10: full.tripComRatingOutOf10,
        consensus: full.consensus,
        providerDivergence: full.providerDivergence,
        providerDivergenceDetails: full.providerDivergenceDetails,
        topicStats: full.topicStats,
      });
    }),
  );
  registered.push("evaluate_hotel_criteria");

  server.registerTool(
    "compare_hotels_batch",
    {
      title: "Batch Compare Multiple Hotels in One Call",
      description:
        "Compare up to 30 hotels in a single batch call across TripAdvisor Terra, Google Places, and Trip.com, returning a compact city-wide comparison table with matchConfidence, ambiguous flags, pricing, amenities, and 5-criteria verdicts.",
      inputSchema: {
        hotels: z
          .array(
            z.object({
              hotelName: z.string().trim().min(1).describe("Hotel name"),
              city: z.string().trim().min(1).describe("City name"),
              country: z.string().trim().optional().describe("Optional country name"),
              tripadvisorLocationId: z.string().trim().optional(),
              googlePlaceId: z.string().trim().optional(),
            }),
          )
          .min(1)
          .max(30)
          .describe("List of hotels to compare (1-30)"),
        language: z
          .string()
          .trim()
          .default("de")
          .optional()
          .describe('Preferred language code (default: "de")'),
        check_in: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
          .optional()
          .describe("Optional check-in date (YYYY-MM-DD)"),
        check_out: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
          .optional()
          .describe("Optional check-out date (YYYY-MM-DD)"),
        guests: z.number().int().min(1).max(20).default(2).describe("Number of guests (default: 2)"),
        includeReviews: z
          .boolean()
          .default(false)
          .optional()
          .describe("Include review fetching per hotel (default: false for faster batch execution)"),
        includeChinaTravel: z
          .boolean()
          .default(false)
          .optional()
          .describe("Run live TripGenie search per hotel (default: false for faster batch execution)"),
        criteria: criteriaSchema,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    withToolErrorHandling("system", async (args) => {
      const concurrency = 4;
      const results: Awaited<ReturnType<typeof runSingleHotelComparison>>[] = [];

      for (let i = 0; i < args.hotels.length; i += concurrency) {
        const chunk = args.hotels.slice(i, i + concurrency);
        const chunkResults = await Promise.all(
          chunk.map((h) =>
            runSingleHotelComparison(providers, {
              hotelName: h.hotelName,
              city: h.city,
              country: h.country,
              tripadvisorLocationId: h.tripadvisorLocationId,
              googlePlaceId: h.googlePlaceId,
              check_in: args.check_in,
              check_out: args.check_out,
              guests: args.guests ?? 2,
              includeReviews: args.includeReviews ?? false,
              includeChinaTravel: args.includeChinaTravel ?? false,
              language: args.language ?? "de",
              criteria: args.criteria,
            }),
          ),
        );
        results.push(...chunkResults);
      }

      const summaryTable = results.map((r) => ({
        hotelName: r.query.hotelName,
        resolvedName: r.resolvedName,
        city: r.query.city,
        matchConfidence: r.matchConfidence,
        ambiguous: r.ambiguous,
        tripadvisorLocationId:
          (r.providers.tripadvisorTerra as { location?: { locationId?: string } }).location
            ?.locationId ?? null,
        googlePlaceId:
          (r.providers.googlePlaces as { place?: { placeId?: string } }).place?.placeId ?? null,
        perNightUsd: r.pricing.perNightUsd,
        priceTier: r.priceTier,
        tripComRatingOutOf10: r.tripComRatingOutOf10,
        tripadvisorRatingOutOf5:
          r.normalizedRatings.find((n) => n.provider === "tripadvisor_terra")?.normalizedOutOf5 ??
          null,
        googleRatingOutOf5:
          r.normalizedRatings.find((n) => n.provider === "google_places")?.normalizedOutOf5 ?? null,
        consensusOutOf5: r.consensus?.scoreOutOf5 ?? null,
        consensusOutOf100: r.consensus?.scoreOutOf100 ?? null,
        providerDivergence: r.providerDivergence,
        overallVerdict: r.criteriaEvaluation.overallVerdict,
        criteriaVerdicts: {
          budget_and_rating: r.criteriaEvaluation.criteria.budget_and_rating.verdict,
          smoking_policy: r.criteriaEvaluation.criteria.smoking_policy.verdict,
          western_breakfast: r.criteriaEvaluation.criteria.western_breakfast.verdict,
          laundry_solution: r.criteriaEvaluation.criteria.laundry_solution.verdict,
          pool_aesthetics_location: r.criteriaEvaluation.criteria.pool_aesthetics_location.verdict,
        },
        amenities: r.amenities,
      }));

      return jsonToolResult({
        count: results.length,
        passedCount: summaryTable.filter((r) => r.overallVerdict === "pass").length,
        failedCount: summaryTable.filter((r) => r.overallVerdict === "fail").length,
        needsVerificationCount: summaryTable.filter((r) => r.overallVerdict === "needs_verification")
          .length,
        summaryTable,
        results,
      });
    }),
  );
  registered.push("compare_hotels_batch");

  return registered;
}
