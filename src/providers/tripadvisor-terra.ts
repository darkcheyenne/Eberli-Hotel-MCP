import type { AppConfig } from "../config.js";
import { TtlCache, buildCacheKey } from "../utils/cache.js";
import { HttpError, ProviderConfigError, fetchJson } from "../utils/http.js";
import {
  type NormalizedRating,
  type NormalizedReview,
  type PriceTier,
  normalizePriceLevel,
  normalizeRating,
  toOptionalNumber,
} from "../utils/normalizer.js";

/**
 * Defensive TripAdvisor Terra API types:
 * Terra omits fields that lack data instead of returning `null`.
 */
export interface TerraAddress {
  street1?: string;
  street2?: string;
  city?: string;
  state?: string;
  country?: string;
  postalcode?: string;
  address_string?: string;
}

export interface TerraCategoryInfo {
  name?: string;
  localized_name?: string;
}

export interface TerraSubrating {
  name?: string;
  localized_name?: string;
  type_name?: string;
  value?: string | number;
  rating_image_url?: string;
  icon_url?: { key?: string; url?: string };
}

export interface TerraLocation {
  location_id?: string | number;
  name?: string;
  description?: string;
  web_url?: string;
  address_obj?: TerraAddress;
  latitude?: string | number;
  longitude?: string | number;
  timezone?: string;
  phone?: string;
  website?: string;
  email?: string;
  rating?: string | number;
  num_reviews?: string | number;
  photo_count?: string | number;
  price_level?: string;
  category?: TerraCategoryInfo | string;
  subcategory?: TerraCategoryInfo[];
  review_rating_count?: Record<string, string | number>;
  subratings?: Record<string, TerraSubrating> | TerraSubrating[];
  matched_value?: string;
  ranking_data?: {
    geo_location_name?: string;
    ranking_string?: string;
    ranking?: string | number;
    ranking_out_of?: string | number;
  };
  amenities?: string[];
  awards?: Array<{ award_type?: string; year?: string | number; display_name?: string }>;
}

export interface TerraPagination {
  page?: number;
  size?: number;
  total_elements?: number;
  total_pages?: number;
}

export interface TerraPagedLocationsResponse {
  data?: TerraLocation[];
  pagination?: TerraPagination;
}

export interface TerraReview {
  id?: string | number;
  location_id?: string | number;
  title?: string;
  text?: string;
  rating?: number | string;
  published_date?: string;
  published_at?: string;
  travel_date?: string;
  trip_type?: string;
  lang?: string;
  language?: string;
  url?: string;
  user?: {
    username?: string;
    user_location?: { name?: string };
  };
  subratings?: Record<string, TerraSubrating> | TerraSubrating[];
  owner_response?: {
    id?: string | number;
    title?: string;
    text?: string;
    published_date?: string;
  };
}

export interface TerraReviewsResponse {
  data?: TerraReview[];
  pagination?: TerraPagination;
}

export interface TerraPhoto {
  id?: string | number;
  caption?: string;
  published_date?: string;
  original_size_url?: string;
  is_blessed?: boolean;
  album?: string;
  source?: {
    name?: string;
    localized_name?: string;
  };
  user?: {
    username?: string;
  };
}

export interface TerraPhotosResponse {
  data?: TerraPhoto[];
  pagination?: TerraPagination;
}

export type TerraCategoryFilter = "HOTEL" | "RESTAURANT" | "ATTRACTION";
export type TerraSearchType = "NAME" | "ADDRESS" | "COMBINED";
export type TerraTripType = "business" | "couples" | "family" | "friends" | "solo";
export type TerraReviewSortBy = "MOST_RECENT" | "HIGHEST_RATED";

export interface TerraSearchInput {
  query: string;
  category?: TerraCategoryFilter;
  search_type?: TerraSearchType;
  country_code?: string;
  geo_name?: string;
  postal_code?: string;
  locale?: string;
  page?: number;
  size?: number;
}

export interface TerraReviewsInput {
  locationId: string | number;
  rating_min?: number;
  trip_type?: TerraTripType;
  published_after_ts?: string;
  language?: string;
  sort_by?: TerraReviewSortBy;
  published_after_review_id?: string;
}

export interface TerraParsedLocation {
  locationId: string;
  name: string;
  description?: string;
  address?: string;
  city?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  webUrl?: string;
  website?: string;
  phone?: string;
  priceTier: PriceTier;
  rawPriceLevel?: string;
  rating?: NormalizedRating;
  category?: string;
  ranking?: string;
  amenities?: string[];
  subratings?: Record<string, number>;
  matchedValue?: string;
}

export interface TripAdvisorTerraOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  cache: TtlCache<unknown>;
  fetchImpl?: typeof fetch;
}

/**
 * TripAdvisor Terra API client (https://terra.tripadvisor.com/api).
 * Handles omitted fields defensively and surfaces clear allowlist-aware 404 errors.
 */
export class TripAdvisorTerraProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly cache: TtlCache<unknown>;
  private readonly fetchImpl?: typeof fetch;

  constructor(options: TripAdvisorTerraOptions) {
    if (!options.apiKey.trim()) {
      throw new ProviderConfigError(
        "tripadvisor_terra",
        "TRIPADVISOR_TERRA_API_KEY is required",
        "Set TRIPADVISOR_TERRA_API_KEY in your environment.",
      );
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? "https://terra.tripadvisor.com/api").replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.maxRetries = options.maxRetries ?? 3;
    this.cache = options.cache;
    this.fetchImpl = options.fetchImpl;
  }

  static fromConfig(
    config: AppConfig,
    cache: TtlCache<unknown>,
    fetchImpl?: typeof fetch,
  ): TripAdvisorTerraProvider | undefined {
    if (!config.tripadvisorTerra.apiKey) {
      return undefined;
    }
    return new TripAdvisorTerraProvider({
      apiKey: config.tripadvisorTerra.apiKey,
      baseUrl: config.tripadvisorTerra.baseUrl,
      timeoutMs: config.httpTimeoutMs,
      maxRetries: config.httpMaxRetries,
      cache,
      fetchImpl,
    });
  }

  private buildUrl(path: string, params?: Record<string, string | number | undefined>): string {
    const url = new URL(`${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`);
    url.searchParams.set("version", "1");
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && String(value).trim().length > 0) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private async request<T>(
    cacheKey: string,
    url: string,
    notFoundContext?: { locationId?: string },
  ): Promise<{ data: T; cached: boolean }> {
    const cachedHit = this.cache.get(cacheKey);
    if (cachedHit !== undefined) {
      return { data: cachedHit as T, cached: true };
    }

    try {
      const data = (await this.cache.getOrSet(cacheKey, async () => {
        return fetchJson<T>({
          provider: "tripadvisor_terra",
          url,
          method: "GET",
          headers: {
            "X-API-Key": this.apiKey,
            Accept: "application/json, application/problem+json",
          },
          timeoutMs: this.timeoutMs,
          maxRetries: this.maxRetries,
          fetchImpl: this.fetchImpl,
        });
      })) as T;

      return { data, cached: false };
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) {
        const locationLabel = notFoundContext?.locationId
          ? `location ID '${notFoundContext.locationId}'`
          : "the requested resource";
        throw new HttpError(
          `TripAdvisor Terra API returned 404 Not Found for ${locationLabel}. In TripAdvisor Terra, locations not on your account allowlist return HTTP 404 rather than partial records.`,
          {
            provider: "tripadvisor_terra",
            status: 404,
            statusText: error.statusText,
            url: error.url,
            body: error.body,
            problemDetails: error.problemDetails,
            actionableHint:
              "Use ta_search_catalog to verify the Location ID exists in TripAdvisor's catalog, and ensure this Location ID is added to your Terra account allowlist in the TripAdvisor Terra developer dashboard.",
          },
        );
      }
      throw error;
    }
  }

  async searchLocations(input: TerraSearchInput): Promise<{
    locations: TerraParsedLocation[];
    pagination?: TerraPagination;
    cached: boolean;
  }> {
    const url = this.buildUrl("/locations/search", {
      query: input.query,
      category: input.category,
      search_type: input.search_type,
      country_code: input.country_code,
      geo_name: input.geo_name,
      postal_code: input.postal_code,
      locale: input.locale,
      page: input.page,
      size: input.size,
    });
    const cacheKey = buildCacheKey("ta_locations_search", { ...input });
    const { data, cached } = await this.request<TerraPagedLocationsResponse>(cacheKey, url);

    const rawItems = Array.isArray(data?.data) ? data.data : [];
    return {
      locations: rawItems.map(TripAdvisorTerraProvider.parseLocation),
      pagination: data?.pagination,
      cached,
    };
  }

  async searchCatalog(input: TerraSearchInput): Promise<{
    locations: TerraParsedLocation[];
    pagination?: TerraPagination;
    cached: boolean;
  }> {
    const url = this.buildUrl("/catalog/locations/search", {
      query: input.query,
      category: input.category,
      search_type: input.search_type,
      country_code: input.country_code,
      geo_name: input.geo_name,
      postal_code: input.postal_code,
      locale: input.locale,
      page: input.page,
      size: input.size,
    });
    const cacheKey = buildCacheKey("ta_catalog_search", { ...input });
    const { data, cached } = await this.request<TerraPagedLocationsResponse>(cacheKey, url);

    const rawItems = Array.isArray(data?.data) ? data.data : [];
    return {
      locations: rawItems.map(TripAdvisorTerraProvider.parseLocation),
      pagination: data?.pagination,
      cached,
    };
  }

  async getLocationDetails(
    locationId: string | number,
    locale?: string,
  ): Promise<{ location: TerraParsedLocation; raw: TerraLocation; cached: boolean }> {
    const id = encodeURIComponent(String(locationId).trim());
    const url = this.buildUrl(`/locations/${id}`, { locale });
    const cacheKey = buildCacheKey("ta_location_details", { locationId: String(locationId), locale });

    const { data, cached } = await this.request<TerraLocation>(cacheKey, url, {
      locationId: String(locationId),
    });

    return {
      location: TripAdvisorTerraProvider.parseLocation(data ?? {}),
      raw: data ?? {},
      cached,
    };
  }

  async getLocationReviews(input: TerraReviewsInput): Promise<{
    reviews: NormalizedReview[];
    pagination?: TerraPagination;
    cached: boolean;
  }> {
    const id = encodeURIComponent(String(input.locationId).trim());
    const url = this.buildUrl(`/locations/${id}/reviews`, {
      rating_min: input.rating_min,
      trip_type: input.trip_type,
      published_after_ts: input.published_after_ts,
      language: input.language,
      sort_by: input.sort_by,
      published_after_review_id: input.published_after_review_id,
    });
    const cacheKey = buildCacheKey("ta_location_reviews", { ...input });

    const { data, cached } = await this.request<TerraReviewsResponse>(cacheKey, url, {
      locationId: String(input.locationId),
    });

    const rawReviews = Array.isArray(data?.data) ? data.data : [];
    return {
      reviews: rawReviews.map(TripAdvisorTerraProvider.parseReview),
      pagination: data?.pagination,
      cached,
    };
  }

  async getLocationPhotos(locationId: string | number): Promise<{
    photos: Array<{
      id?: string;
      caption?: string;
      url?: string;
      source?: string;
      publishedDate?: string;
      author?: string;
    }>;
    pagination?: TerraPagination;
    cached: boolean;
  }> {
    const id = encodeURIComponent(String(locationId).trim());
    const url = this.buildUrl(`/locations/${id}/photos`);
    const cacheKey = buildCacheKey("ta_location_photos", { locationId: String(locationId) });

    const { data, cached } = await this.request<TerraPhotosResponse>(cacheKey, url, {
      locationId: String(locationId),
    });

    const rawPhotos = Array.isArray(data?.data) ? data.data : [];
    return {
      photos: rawPhotos.map((photo) => ({
        id: photo.id !== undefined ? String(photo.id) : undefined,
        caption: photo.caption,
        url: photo.original_size_url,
        source: photo.source?.localized_name ?? photo.source?.name,
        publishedDate: photo.published_date,
        author: photo.user?.username,
      })),
      pagination: data?.pagination,
      cached,
    };
  }

  static parseSubratings(
    raw: Record<string, TerraSubrating> | TerraSubrating[] | undefined,
  ): Record<string, number> | undefined {
    if (!raw) return undefined;
    const entries = Array.isArray(raw) ? raw : Object.values(raw);
    const result: Record<string, number> = {};
    for (const item of entries) {
      if (!item) continue;
      const label = item.type_name ?? item.localized_name ?? item.name;
      const numericVal = toOptionalNumber(item.value);
      if (label && numericVal !== undefined) {
        result[label] = numericVal;
      }
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }

  static parseLocation(raw: TerraLocation): TerraParsedLocation {
    const addressParts = [
      raw.address_obj?.street1,
      raw.address_obj?.city,
      raw.address_obj?.state,
      raw.address_obj?.postalcode,
      raw.address_obj?.country,
    ].filter((part): part is string => typeof part === "string" && part.trim().length > 0);

    const address =
      raw.address_obj?.address_string ??
      (addressParts.length > 0 ? addressParts.join(", ") : undefined);

    const category =
      typeof raw.category === "string"
        ? raw.category
        : raw.category?.localized_name ?? raw.category?.name;

    return {
      locationId: raw.location_id !== undefined ? String(raw.location_id) : "unknown",
      name: raw.name ?? "Unnamed Location",
      description: raw.description,
      address,
      city: raw.address_obj?.city,
      country: raw.address_obj?.country,
      latitude: toOptionalNumber(raw.latitude),
      longitude: toOptionalNumber(raw.longitude),
      webUrl: raw.web_url,
      website: raw.website,
      phone: raw.phone,
      priceTier: normalizePriceLevel(raw.price_level),
      rawPriceLevel: raw.price_level,
      rating: normalizeRating("tripadvisor_terra", raw.rating, 5, raw.num_reviews),
      category,
      ranking: raw.ranking_data?.ranking_string,
      amenities: Array.isArray(raw.amenities) ? raw.amenities : undefined,
      subratings: TripAdvisorTerraProvider.parseSubratings(raw.subratings),
      matchedValue: raw.matched_value,
    };
  }

  static parseReview(raw: TerraReview): NormalizedReview {
    return {
      provider: "tripadvisor_terra",
      id: raw.id !== undefined ? String(raw.id) : undefined,
      author: raw.user?.username,
      ratingOutOf5: toOptionalNumber(raw.rating),
      title: raw.title,
      text: raw.text,
      publishedAt: raw.published_date ?? raw.published_at,
      tripType: raw.trip_type,
      language: raw.language ?? raw.lang,
      subratings: TripAdvisorTerraProvider.parseSubratings(raw.subratings),
    };
  }
}
