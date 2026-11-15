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
export interface TerraLocalizedString {
  language?: string;
  value?: string;
  primary?: boolean;
}

export interface TerraAddress {
  street1?: string;
  street2?: string;
  street_address?: string;
  city?: string;
  state?: string;
  country?: string;
  country_name?: string;
  country_code?: string;
  postalcode?: string;
  postal_code?: string;
  address_string?: string;
  formatted?: string;
}

export interface TerraCategoryInfo {
  name?: string;
  localized_name?: string;
}

export interface TerraSubrating {
  type?: string;
  name?: string;
  localized_name?: string;
  type_name?: string;
  value?: string | number;
  rating?: string | number;
  count?: number;
  rating_image_url?: string;
  icon_url?: string | { key?: string; url?: string };
}

export interface TerraLocation {
  id?: string | number;
  location_id?: string | number;
  name?: string;
  names?: TerraLocalizedString[];
  description?: string;
  descriptions?: TerraLocalizedString[];
  web_url?: string;
  urls?: {
    tripadvisor?: {
      main?: string;
      photos?: string;
      write_review?: string;
      questions_answers?: string;
    };
    official?: string;
  };
  address_obj?: TerraAddress;
  addresses?: TerraAddress[];
  latitude?: string | number;
  longitude?: string | number;
  coordinates?: {
    latitude?: number | string;
    longitude?: number | string;
  };
  timezone?: string;
  phone?: string;
  phone_numbers?: Array<{ value?: string; type?: string }>;
  website?: string;
  email?: string;
  official_email?: string;
  rating?: string | number;
  num_reviews?: string | number;
  overall_rating?: {
    rating?: number | string;
    count?: number | string;
    icon_url?: string;
  };
  traveler_ratings?: {
    overall?: {
      rating?: number | string;
      count?: number | string;
      icon_url?: string;
    };
    subratings?: TerraSubrating[];
  };
  photo_count?: string | number;
  photos?: {
    total_count?: number;
  };
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
  location?: TerraLocation;
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
  title?: string | TerraLocalizedString[];
  text?: string | TerraLocalizedString[];
  rating?: number | string;
  publish_ts?: string;
  published_date?: string;
  published_at?: string;
  travel_date?: string;
  trip_type?: string;
  lang?: string;
  language?: string;
  url?: string;
  user?: {
    username?: string;
    geo?: string;
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
  location_id?: string | number;
  caption?: string;
  publish_ts?: string;
  published_date?: string;
  original_size_url?: string;
  photo?: {
    key?: string;
    original_size_url?: string;
    original_height?: number;
    original_width?: number;
    media_type?: string;
  };
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

    if (notFoundContext?.locationId) {
      const negKey = buildCacheKey("ta_404_not_allowlisted", {
        locationId: notFoundContext.locationId,
      });
      const cached404 = this.cache.get(negKey) as
        | { statusText: string; url: string; body: unknown; problemDetails?: HttpError["problemDetails"] }
        | undefined;
      if (cached404 !== undefined) {
        const locationLabel = `location ID '${notFoundContext.locationId}'`;
        throw new HttpError(
          `TripAdvisor Terra API returned 404 Not Found for ${locationLabel}. In TripAdvisor Terra, locations not on your account allowlist return HTTP 404 rather than partial records.`,
          {
            provider: "tripadvisor_terra",
            status: 404,
            statusText: cached404.statusText,
            url: cached404.url,
            body: cached404.body,
            problemDetails: cached404.problemDetails,
            actionableHint:
              "Use ta_search_catalog to verify the Location ID exists in TripAdvisor's catalog, and ensure this Location ID is added to your Terra account allowlist in the TripAdvisor Terra developer dashboard.",
          },
        );
      }
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
        if (notFoundContext?.locationId) {
          const negKey = buildCacheKey("ta_404_not_allowlisted", {
            locationId: notFoundContext.locationId,
          });
          this.cache.set(negKey, {
            statusText: error.statusText,
            url: error.url,
            body: error.body,
            problemDetails: error.problemDetails,
          });
        }
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
    const parsedLocations = rawItems.map((rawWrapper) => {
      const parsed = TripAdvisorTerraProvider.parseLocation(rawWrapper);
      const unwrapped = rawWrapper.location ?? rawWrapper;
      // If searchLocations returned a full Terra v1 location payload (with subratings or descriptions),
      // pre-warm the ta_location_details cache so a follow-up getLocationDetails(id) hits cache without an HTTP call.
      if (
        parsed.locationId !== "unknown" &&
        (unwrapped.traveler_ratings !== undefined || unwrapped.descriptions !== undefined)
      ) {
        const defaultDetailsKey = buildCacheKey("ta_location_details", {
          locationId: parsed.locationId,
          locale: undefined,
        });
        this.cache.set(defaultDetailsKey, unwrapped);
        if (input.locale) {
          const localeDetailsKey = buildCacheKey("ta_location_details", {
            locationId: parsed.locationId,
            locale: input.locale,
          });
          this.cache.set(localeDetailsKey, unwrapped);
        }
      }
      return parsed;
    });

    return {
      locations: parsedLocations,
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
        url: photo.photo?.original_size_url ?? photo.original_size_url,
        source: photo.source?.localized_name ?? photo.source?.name,
        publishedDate: photo.publish_ts ?? photo.published_date,
        author: photo.user?.username,
      })),
      pagination: data?.pagination,
      cached,
    };
  }

  static pickLocalizedString(
    input: string | TerraLocalizedString[] | undefined,
  ): { value?: string; language?: string } {
    if (typeof input === "string") {
      return { value: input };
    }
    if (Array.isArray(input) && input.length > 0) {
      const primary = input.find((item) => item?.primary && typeof item.value === "string");
      const chosen = primary ?? input.find((item) => typeof item?.value === "string");
      return { value: chosen?.value, language: chosen?.language };
    }
    return {};
  }

  static parseSubratings(
    raw: Record<string, TerraSubrating> | TerraSubrating[] | undefined,
  ): Record<string, number> | undefined {
    if (!raw) return undefined;
    const entries = Array.isArray(raw) ? raw : Object.values(raw);
    const result: Record<string, number> = {};
    for (const item of entries) {
      if (!item) continue;
      const label = item.type_name ?? item.localized_name ?? item.name ?? item.type;
      const numericVal = toOptionalNumber(item.rating ?? item.value);
      if (label && numericVal !== undefined) {
        result[label] = numericVal;
      }
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }

  static parseLocation(rawWrapper: TerraLocation): TerraParsedLocation {
    const raw = rawWrapper.location ?? rawWrapper;
    const matchedValue = rawWrapper.matched_value ?? raw.matched_value;

    const primaryAddress = raw.addresses?.[0] ?? raw.address_obj;
    const addressParts = [
      primaryAddress?.street_address ?? primaryAddress?.street1,
      primaryAddress?.city,
      primaryAddress?.state,
      primaryAddress?.postal_code ?? primaryAddress?.postalcode,
      primaryAddress?.country_name ?? primaryAddress?.country,
    ].filter((part): part is string => typeof part === "string" && part.trim().length > 0);

    const address =
      primaryAddress?.formatted ??
      primaryAddress?.address_string ??
      (addressParts.length > 0 ? addressParts.join(", ") : undefined);

    const category =
      typeof raw.category === "string"
        ? raw.category
        : raw.category?.localized_name ?? raw.category?.name;

    const rawId = raw.id ?? raw.location_id;
    const resolvedName =
      TripAdvisorTerraProvider.pickLocalizedString(raw.names).value ??
      raw.name ??
      "Unnamed Location";
    const resolvedDescription =
      TripAdvisorTerraProvider.pickLocalizedString(raw.descriptions).value ?? raw.description;

    const ratingScore =
      raw.traveler_ratings?.overall?.rating ?? raw.overall_rating?.rating ?? raw.rating;
    const reviewCount =
      raw.traveler_ratings?.overall?.count ?? raw.overall_rating?.count ?? raw.num_reviews;

    const subratingsSource = raw.traveler_ratings?.subratings ?? raw.subratings;

    return {
      locationId: rawId !== undefined ? String(rawId) : "unknown",
      name: resolvedName,
      description: resolvedDescription,
      address,
      city: primaryAddress?.city,
      country: primaryAddress?.country_name ?? primaryAddress?.country,
      latitude: toOptionalNumber(raw.coordinates?.latitude ?? raw.latitude),
      longitude: toOptionalNumber(raw.coordinates?.longitude ?? raw.longitude),
      webUrl: raw.urls?.tripadvisor?.main ?? raw.web_url,
      website: raw.urls?.official ?? raw.website,
      phone: raw.phone_numbers?.[0]?.value ?? raw.phone,
      priceTier: normalizePriceLevel(raw.price_level),
      rawPriceLevel: raw.price_level,
      rating: normalizeRating("tripadvisor_terra", ratingScore, 5, reviewCount),
      category,
      ranking: raw.ranking_data?.ranking_string,
      amenities: Array.isArray(raw.amenities) ? raw.amenities : undefined,
      subratings: TripAdvisorTerraProvider.parseSubratings(subratingsSource),
      matchedValue,
    };
  }

  static parseReview(raw: TerraReview): NormalizedReview {
    const titleObj = TripAdvisorTerraProvider.pickLocalizedString(raw.title);
    const textObj = TripAdvisorTerraProvider.pickLocalizedString(raw.text);

    return {
      provider: "tripadvisor_terra",
      id: raw.id !== undefined ? String(raw.id) : undefined,
      author: raw.user?.username,
      ratingOutOf5: toOptionalNumber(raw.rating),
      title: titleObj.value,
      text: textObj.value,
      publishedAt: raw.publish_ts ?? raw.published_date ?? raw.published_at,
      tripType: raw.trip_type,
      language: raw.language ?? raw.lang ?? textObj.language ?? titleObj.language,
      subratings: TripAdvisorTerraProvider.parseSubratings(raw.subratings),
    };
  }
}
