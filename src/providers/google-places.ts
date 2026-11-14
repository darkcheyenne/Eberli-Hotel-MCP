import type { AppConfig } from "../config.js";
import { TtlCache, buildCacheKey } from "../utils/cache.js";
import { ProviderConfigError, fetchJson } from "../utils/http.js";
import {
  type NormalizedRating,
  type NormalizedReview,
  type PriceTier,
  normalizePriceLevel,
  normalizeRating,
} from "../utils/normalizer.js";

export interface GoogleLocalizedText {
  text?: string;
  languageCode?: string;
}

export interface GoogleLatLng {
  latitude?: number;
  longitude?: number;
}

export interface GooglePlaceReview {
  name?: string;
  relativePublishTimeDescription?: string;
  rating?: number;
  text?: GoogleLocalizedText;
  originalText?: GoogleLocalizedText;
  authorAttribution?: {
    displayName?: string;
    uri?: string;
    photoUri?: string;
  };
  publishTime?: string;
}

export interface GooglePlacePhoto {
  name?: string;
  widthPx?: number;
  heightPx?: number;
  authorAttributions?: Array<{
    displayName?: string;
    uri?: string;
  }>;
}

export interface GooglePlace {
  name?: string;
  id?: string;
  displayName?: GoogleLocalizedText;
  formattedAddress?: string;
  shortFormattedAddress?: string;
  location?: GoogleLatLng;
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  types?: string[];
  primaryType?: string;
  primaryTypeDisplayName?: GoogleLocalizedText;
  googleMapsUri?: string;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  businessStatus?: string;
  editorialSummary?: GoogleLocalizedText;
  regularOpeningHours?: {
    openNow?: boolean;
    weekdayDescriptions?: string[];
  };
  currentOpeningHours?: {
    openNow?: boolean;
    weekdayDescriptions?: string[];
  };
  reviews?: GooglePlaceReview[];
  photos?: GooglePlacePhoto[];
}

export interface GoogleSearchResponse {
  places?: GooglePlace[];
  nextPageToken?: string;
}

export interface GooglePhotoMediaResponse {
  name?: string;
  photoUri?: string;
}

export interface GoogleTextSearchInput {
  textQuery: string;
  includedType?: string;
  languageCode?: string;
  regionCode?: string;
  maxResultCount?: number;
  minRating?: number;
  priceLevels?: Array<
    | "PRICE_LEVEL_INEXPENSIVE"
    | "PRICE_LEVEL_MODERATE"
    | "PRICE_LEVEL_EXPENSIVE"
    | "PRICE_LEVEL_VERY_EXPENSIVE"
  >;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
}

export interface GoogleNearbySearchInput {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  includedTypes?: string[];
  excludedTypes?: string[];
  maxResultCount?: number;
  languageCode?: string;
  regionCode?: string;
  rankPreference?: "POPULARITY" | "DISTANCE";
}

export interface GooglePlaceDetailsInput {
  placeId: string;
  languageCode?: string;
  regionCode?: string;
  includeReviews?: boolean;
  includePhotos?: boolean;
}

export interface GoogleParsedPlace {
  placeId: string;
  resourceName?: string;
  name: string;
  address?: string;
  shortAddress?: string;
  latitude?: number;
  longitude?: number;
  rating?: NormalizedRating;
  priceTier: PriceTier;
  rawPriceLevel?: string;
  primaryType?: string;
  types?: string[];
  googleMapsUri?: string;
  websiteUri?: string;
  phone?: string;
  businessStatus?: string;
  openNow?: boolean;
  weekdayHours?: string[];
  editorialSummary?: string;
  reviews?: NormalizedReview[];
  photos?: Array<{
    name: string;
    widthPx?: number;
    heightPx?: number;
  }>;
}

export interface GooglePlacesOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  cache: TtlCache<unknown>;
  fetchImpl?: typeof fetch;
}

const SEARCH_FIELD_MASK = [
  "places.id",
  "places.name",
  "places.displayName",
  "places.formattedAddress",
  "places.shortFormattedAddress",
  "places.location",
  "places.rating",
  "places.userRatingCount",
  "places.priceLevel",
  "places.types",
  "places.primaryType",
  "places.primaryTypeDisplayName",
  "places.googleMapsUri",
  "places.websiteUri",
  "places.internationalPhoneNumber",
  "places.businessStatus",
  "places.editorialSummary",
  "places.regularOpeningHours.openNow",
].join(",");

const DETAILS_BASE_FIELDS = [
  "id",
  "name",
  "displayName",
  "formattedAddress",
  "shortFormattedAddress",
  "location",
  "rating",
  "userRatingCount",
  "priceLevel",
  "types",
  "primaryType",
  "primaryTypeDisplayName",
  "googleMapsUri",
  "websiteUri",
  "nationalPhoneNumber",
  "internationalPhoneNumber",
  "businessStatus",
  "editorialSummary",
  "currentOpeningHours.openNow",
  "regularOpeningHours.openNow",
  "regularOpeningHours.weekdayDescriptions",
];

/**
 * Google Places API (New) client (https://places.googleapis.com/v1).
 */
export class GooglePlacesProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly cache: TtlCache<unknown>;
  private readonly fetchImpl?: typeof fetch;

  constructor(options: GooglePlacesOptions) {
    if (!options.apiKey.trim()) {
      throw new ProviderConfigError(
        "google_places",
        "GOOGLE_PLACES_API_KEY is required",
        "Set GOOGLE_PLACES_API_KEY in your environment.",
      );
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? "https://places.googleapis.com/v1").replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.maxRetries = options.maxRetries ?? 3;
    this.cache = options.cache;
    this.fetchImpl = options.fetchImpl;
  }

  static fromConfig(
    config: AppConfig,
    cache: TtlCache<unknown>,
    fetchImpl?: typeof fetch,
  ): GooglePlacesProvider | undefined {
    if (!config.googlePlaces.apiKey) {
      return undefined;
    }
    return new GooglePlacesProvider({
      apiKey: config.googlePlaces.apiKey,
      baseUrl: config.googlePlaces.baseUrl,
      timeoutMs: config.httpTimeoutMs,
      maxRetries: config.httpMaxRetries,
      cache,
      fetchImpl,
    });
  }

  async searchText(input: GoogleTextSearchInput): Promise<{
    places: GoogleParsedPlace[];
    cached: boolean;
  }> {
    const cacheKey = buildCacheKey("gplaces_search_text", { ...input });
    const cachedHit = this.cache.get(cacheKey);
    if (cachedHit !== undefined) {
      return { places: cachedHit as GoogleParsedPlace[], cached: true };
    }

    const body: Record<string, unknown> = {
      textQuery: input.textQuery,
    };
    if (input.includedType) body.includedType = input.includedType;
    if (input.languageCode) body.languageCode = input.languageCode;
    if (input.regionCode) body.regionCode = input.regionCode;
    if (input.maxResultCount !== undefined) body.maxResultCount = input.maxResultCount;
    if (input.minRating !== undefined) body.minRating = input.minRating;
    if (input.priceLevels && input.priceLevels.length > 0) body.priceLevels = input.priceLevels;
    if (input.latitude !== undefined && input.longitude !== undefined) {
      body.locationBias = {
        circle: {
          center: { latitude: input.latitude, longitude: input.longitude },
          radius: input.radiusMeters ?? 5000,
        },
      };
    }

    const places = (await this.cache.getOrSet(cacheKey, async () => {
      const response = await fetchJson<GoogleSearchResponse>({
        provider: "google_places",
        url: `${this.baseUrl}/places:searchText`,
        method: "POST",
        headers: {
          "X-Goog-Api-Key": this.apiKey,
          "X-Goog-FieldMask": SEARCH_FIELD_MASK,
        },
        body,
        timeoutMs: this.timeoutMs,
        maxRetries: this.maxRetries,
        fetchImpl: this.fetchImpl,
      });

      return (response.places ?? []).map(GooglePlacesProvider.parsePlace);
    })) as GoogleParsedPlace[];

    return { places, cached: false };
  }

  async searchNearby(input: GoogleNearbySearchInput): Promise<{
    places: GoogleParsedPlace[];
    cached: boolean;
  }> {
    const cacheKey = buildCacheKey("gplaces_search_nearby", { ...input });
    const cachedHit = this.cache.get(cacheKey);
    if (cachedHit !== undefined) {
      return { places: cachedHit as GoogleParsedPlace[], cached: true };
    }

    const body: Record<string, unknown> = {
      locationRestriction: {
        circle: {
          center: {
            latitude: input.latitude,
            longitude: input.longitude,
          },
          radius: input.radiusMeters,
        },
      },
    };
    if (input.includedTypes && input.includedTypes.length > 0) {
      body.includedTypes = input.includedTypes;
    }
    if (input.excludedTypes && input.excludedTypes.length > 0) {
      body.excludedTypes = input.excludedTypes;
    }
    if (input.maxResultCount !== undefined) body.maxResultCount = input.maxResultCount;
    if (input.languageCode) body.languageCode = input.languageCode;
    if (input.regionCode) body.regionCode = input.regionCode;
    if (input.rankPreference) body.rankPreference = input.rankPreference;

    const places = (await this.cache.getOrSet(cacheKey, async () => {
      const response = await fetchJson<GoogleSearchResponse>({
        provider: "google_places",
        url: `${this.baseUrl}/places:searchNearby`,
        method: "POST",
        headers: {
          "X-Goog-Api-Key": this.apiKey,
          "X-Goog-FieldMask": SEARCH_FIELD_MASK,
        },
        body,
        timeoutMs: this.timeoutMs,
        maxRetries: this.maxRetries,
        fetchImpl: this.fetchImpl,
      });

      return (response.places ?? []).map(GooglePlacesProvider.parsePlace);
    })) as GoogleParsedPlace[];

    return { places, cached: false };
  }

  async getPlaceDetails(input: GooglePlaceDetailsInput): Promise<{
    place: GoogleParsedPlace;
    cached: boolean;
  }> {
    const cleanId = input.placeId.replace(/^places\//, "").trim();
    const includeReviews = input.includeReviews ?? true;
    const includePhotos = input.includePhotos ?? false;

    const cacheKey = buildCacheKey("gplaces_details", {
      cleanId,
      languageCode: input.languageCode,
      regionCode: input.regionCode,
      includeReviews,
      includePhotos,
    });

    const cachedHit = this.cache.get(cacheKey);
    if (cachedHit !== undefined) {
      return { place: cachedHit as GoogleParsedPlace, cached: true };
    }

    const fields = [...DETAILS_BASE_FIELDS];
    if (includeReviews) fields.push("reviews");
    if (includePhotos) fields.push("photos");

    const url = new URL(`${this.baseUrl}/places/${encodeURIComponent(cleanId)}`);
    if (input.languageCode) url.searchParams.set("languageCode", input.languageCode);
    if (input.regionCode) url.searchParams.set("regionCode", input.regionCode);

    const place = (await this.cache.getOrSet(cacheKey, async () => {
      const response = await fetchJson<GooglePlace>({
        provider: "google_places",
        url: url.toString(),
        method: "GET",
        headers: {
          "X-Goog-Api-Key": this.apiKey,
          "X-Goog-FieldMask": fields.join(","),
        },
        timeoutMs: this.timeoutMs,
        maxRetries: this.maxRetries,
        fetchImpl: this.fetchImpl,
      });

      return GooglePlacesProvider.parsePlace(response);
    })) as GoogleParsedPlace;

    return { place, cached: false };
  }

  async getPlacePhotoUrl(input: {
    photoName: string;
    maxWidthPx?: number;
    maxHeightPx?: number;
  }): Promise<{ name: string; photoUri?: string; cached: boolean }> {
    const cleanPhotoName = input.photoName.replace(/^\/+/, "");
    const cacheKey = buildCacheKey("gplaces_photo_media", {
      cleanPhotoName,
      maxWidthPx: input.maxWidthPx,
      maxHeightPx: input.maxHeightPx,
    });

    const cachedHit = this.cache.get(cacheKey);
    if (cachedHit !== undefined) {
      return { ...(cachedHit as { name: string; photoUri?: string }), cached: true };
    }

    const url = new URL(`${this.baseUrl}/${cleanPhotoName}/media`);
    url.searchParams.set("skipHttpRedirect", "true");
    if (input.maxWidthPx !== undefined) {
      url.searchParams.set("maxWidthPx", String(input.maxWidthPx));
    } else if (input.maxHeightPx === undefined) {
      url.searchParams.set("maxWidthPx", "1200");
    }
    if (input.maxHeightPx !== undefined) {
      url.searchParams.set("maxHeightPx", String(input.maxHeightPx));
    }

    const result = (await this.cache.getOrSet(cacheKey, async () => {
      const response = await fetchJson<GooglePhotoMediaResponse>({
        provider: "google_places",
        url: url.toString(),
        method: "GET",
        headers: {
          "X-Goog-Api-Key": this.apiKey,
        },
        timeoutMs: this.timeoutMs,
        maxRetries: this.maxRetries,
        fetchImpl: this.fetchImpl,
      });

      return {
        name: response.name ?? cleanPhotoName,
        photoUri: response.photoUri,
      };
    })) as { name: string; photoUri?: string };

    return { ...result, cached: false };
  }

  static parsePlace(raw: GooglePlace): GoogleParsedPlace {
    const id = raw.id ?? raw.name?.replace(/^places\//, "") ?? "unknown";
    const reviews: NormalizedReview[] | undefined = Array.isArray(raw.reviews)
      ? raw.reviews.map((rev) => ({
          provider: "google_places",
          id: rev.name,
          author: rev.authorAttribution?.displayName,
          ratingOutOf5: rev.rating,
          text: rev.text?.text ?? rev.originalText?.text,
          publishedAt: rev.publishTime,
          relativeTime: rev.relativePublishTimeDescription,
          language: rev.text?.languageCode ?? rev.originalText?.languageCode,
        }))
      : undefined;

    const photos = Array.isArray(raw.photos)
      ? raw.photos
          .filter((p): p is GooglePlacePhoto & { name: string } => typeof p.name === "string")
          .map((p) => ({
            name: p.name,
            widthPx: p.widthPx,
            heightPx: p.heightPx,
          }))
      : undefined;

    return {
      placeId: id,
      resourceName: raw.name,
      name: raw.displayName?.text ?? "Unnamed Place",
      address: raw.formattedAddress,
      shortAddress: raw.shortFormattedAddress,
      latitude: raw.location?.latitude,
      longitude: raw.location?.longitude,
      rating: normalizeRating("google_places", raw.rating, 5, raw.userRatingCount),
      priceTier: normalizePriceLevel(raw.priceLevel),
      rawPriceLevel: raw.priceLevel,
      primaryType: raw.primaryTypeDisplayName?.text ?? raw.primaryType,
      types: raw.types,
      googleMapsUri: raw.googleMapsUri,
      websiteUri: raw.websiteUri,
      phone: raw.internationalPhoneNumber ?? raw.nationalPhoneNumber,
      businessStatus: raw.businessStatus,
      openNow: raw.currentOpeningHours?.openNow ?? raw.regularOpeningHours?.openNow,
      weekdayHours: raw.regularOpeningHours?.weekdayDescriptions,
      editorialSummary: raw.editorialSummary?.text,
      reviews,
      photos,
    };
  }
}
