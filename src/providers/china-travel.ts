import type { AppConfig } from "../config.js";
import { TtlCache, buildCacheKey } from "../utils/cache.js";
import { fetchJson } from "../utils/http.js";

export type ChinaCommandType =
  | "hotel"
  | "flight"
  | "attraction"
  | "itinerary"
  | "query";

export interface ChinaHotelSearchInput {
  city: string;
  check_in?: string;
  check_out?: string;
  guests?: number;
  budget?: string;
  preferences?: string;
  area?: string;
  tier?: string;
  maxPriceUsd?: number;
  keyword?: string;
  limit?: number;
  locale?: string;
}

export interface ChinaHotelReviewsInput {
  hotelName?: string;
  hotelId?: string;
  city?: string;
  limit?: number;
  language?: string;
  query?: string;
  topics?: string[];
}

export interface ChinaFlightSearchInput {
  origin: string;
  destination: string;
  date: string;
  trip_type?: "one way" | "round trip";
  cabin?: "economy" | "business" | "first";
  locale?: string;
}

export interface ChinaAttractionSearchInput {
  city: string;
  days?: number;
  interests?: string;
  locale?: string;
}

export interface ChinaItineraryPlanInput {
  city: string;
  days: number;
  travelers?: number;
  interests?: string;
  budget?: string;
  locale?: string;
}

export interface ChinaTravelTipsInput {
  question: string;
  locale?: string;
}

export interface ChinaTravelResult {
  commandType: ChinaCommandType;
  locale: string;
  query: string;
  content: string;
  cached: boolean;
}

export interface ChinaTravelProviderOptions {
  proxyUrl: string;
  proxyToken: string;
  timeoutMs: number;
  maxRetries: number;
  cache: TtlCache<unknown>;
  fetchImpl?: typeof fetch;
}

/**
 * Native TypeScript port of mako202605/china-travel-mcp (TripGenie SCF proxy client).
 */
export class ChinaTravelProvider {
  private readonly proxyUrl: string;
  private readonly proxyToken: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly cache: TtlCache<unknown>;
  private readonly fetchImpl?: typeof fetch;

  constructor(options: ChinaTravelProviderOptions) {
    this.proxyUrl = options.proxyUrl;
    this.proxyToken = options.proxyToken;
    this.timeoutMs = options.timeoutMs;
    this.maxRetries = options.maxRetries;
    this.cache = options.cache;
    this.fetchImpl = options.fetchImpl;
  }

  static fromConfig(
    config: AppConfig,
    cache: TtlCache<unknown>,
    fetchImpl?: typeof fetch,
  ): ChinaTravelProvider {
    return new ChinaTravelProvider({
      proxyUrl: config.chinaTravel.proxyUrl,
      proxyToken: config.chinaTravel.proxyToken,
      timeoutMs: config.chinaTravel.timeoutMs,
      maxRetries: config.httpMaxRetries,
      cache,
      fetchImpl,
    });
  }

  async queryTripGenie(
    query: string,
    locale = "en",
    commandType: ChinaCommandType = "query",
  ): Promise<ChinaTravelResult> {
    const cacheKey = buildCacheKey("china_travel", { query, locale, commandType });
    const cachedHit = this.cache.get(cacheKey);
    if (typeof cachedHit === "string") {
      return {
        commandType,
        locale,
        query,
        content: cachedHit,
        cached: true,
      };
    }

    const content = (await this.cache.getOrSet(cacheKey, async () => {
      const response = await fetchJson<unknown>({
        provider: "china_travel",
        url: this.proxyUrl,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Proxy-Token": this.proxyToken,
          "User-Agent": "ChinaTravelMCP/1.0",
        },
        body: {
          query,
          locale,
          command_type: commandType,
        },
        timeoutMs: this.timeoutMs,
        maxRetries: this.maxRetries,
        fetchImpl: this.fetchImpl,
      });

      return ChinaTravelProvider.parseProxyResponse(response);
    })) as string;

    return {
      commandType,
      locale,
      query,
      content,
      cached: false,
    };
  }

  static parseProxyResponse(result: unknown): string {
    if (typeof result === "string") {
      return result;
    }
    if (typeof result === "object" && result !== null && "data" in result) {
      const data = (result as { data?: unknown }).data;
      if (typeof data === "string") return data;
      if (data === undefined || data === null) return "";
      return JSON.stringify(data);
    }
    if (result === undefined || result === null) {
      return "";
    }
    return JSON.stringify(result);
  }

  async searchHotels(input: ChinaHotelSearchInput): Promise<ChinaTravelResult> {
    const guests = input.guests ?? 2;
    const parts: string[] = [`Find hotels in ${input.city}`];
    if (input.area) {
      parts.push(`area/district: ${input.area}`);
    }
    if (input.check_in && input.check_out) {
      parts.push(`from ${input.check_in} to ${input.check_out}`);
    }
    parts.push(`for ${guests} guest${guests > 1 ? "s" : ""}`);
    if (input.tier) {
      parts.push(`tier: ${input.tier}`);
    }
    if (input.budget) {
      parts.push(`budget: ${input.budget}`);
    }
    if (input.maxPriceUsd !== undefined) {
      parts.push(`max price: $${input.maxPriceUsd} USD/night`);
    }
    if (input.keyword) {
      parts.push(`keyword: ${input.keyword}`);
    }
    if (input.preferences) {
      parts.push(`preferences: ${input.preferences}`);
    }
    if (input.limit !== undefined) {
      parts.push(`limit: top ${input.limit} hotels`);
    }
    parts.push(
      "Include hotel names, prices per night, ratings, key features, and booking links.",
    );

    return this.queryTripGenie(parts.join(", "), input.locale ?? "en", "hotel");
  }

  async getHotelReviews(input: ChinaHotelReviewsInput): Promise<ChinaTravelResult> {
    const target = input.hotelName ?? input.hotelId ?? "Hotel";
    const cityPart = input.city ? ` in ${input.city}` : "";
    const lang = input.language ?? "de";
    const limit = Math.min(20, Math.max(1, input.limit ?? 10));
    const topicFilter = input.query ? ` focusing on "${input.query}"` : "";

    const prompt = `Return ONLY valid JSON (no markdown) for hotel "${target}"${cityPart} with Trip.com guest reviews${topicFilter} and topic analysis: {"hotelName": string, "tripComRatingOutOf10": number, "totalReviews": number, "topicStats": {"breakfast": {"mentions": number, "reviews": number, "negative": number}, "smoking": {"mentions": number, "reviews": number, "negative": number}, "noise": {"mentions": number, "reviews": number, "negative": number}, "pool": {"mentions": number, "reviews": number, "negative": number}, "cleanliness": {"mentions": number, "reviews": number, "negative": number}, "service": {"mentions": number, "reviews": number, "negative": number}, "laundry": {"mentions": number, "reviews": number, "negative": number}}, "reviews": [{"id": string, "author": string, "ratingOutOf5": number, "ratingOutOf10": number, "title": string, "text": string, "publishedAt": string, "tripType": string, "language": "${lang}"}]} Provide up to ${limit} detailed reviews in language "${lang}".`;

    return this.queryTripGenie(prompt, lang, "query");
  }

  async searchFlights(input: ChinaFlightSearchInput): Promise<ChinaTravelResult> {
    const tripType = input.trip_type ?? "one way";
    const cabin = input.cabin ?? "economy";
    const query = `Find ${cabin} class flights from ${input.origin} to ${input.destination} on ${input.date}, ${tripType}. Include airline names, flight numbers, departure and arrival times, prices, and booking links.`;
    return this.queryTripGenie(query, input.locale ?? "en", "flight");
  }

  async searchAttractions(input: ChinaAttractionSearchInput): Promise<ChinaTravelResult> {
    const days = input.days ?? 1;
    const parts: string[] = [`What are the top attractions and things to do in ${input.city}`];
    if (days > 1) {
      parts.push(`for ${days} days`);
    }
    if (input.interests) {
      parts.push(`interested in: ${input.interests}`);
    }
    parts.push(
      "Include ticket prices, opening hours, location, and practical tips if available.",
    );
    return this.queryTripGenie(parts.join(", "), input.locale ?? "en", "attraction");
  }

  async planItinerary(input: ChinaItineraryPlanInput): Promise<ChinaTravelResult> {
    const travelers = input.travelers ?? 2;
    const parts: string[] = [
      `Plan a ${input.days}-day itinerary for ${input.city}`,
      `for ${travelers} traveler${travelers > 1 ? "s" : ""}`,
    ];
    if (input.interests) {
      parts.push(`interests: ${input.interests}`);
    }
    if (input.budget) {
      parts.push(`budget level: ${input.budget}`);
    }
    parts.push(
      "Include hotel recommendations, must-see attractions, dining suggestions, local transportation tips, and practical advice.",
    );
    return this.queryTripGenie(parts.join(", "), input.locale ?? "en", "itinerary");
  }

  async getTravelTips(input: ChinaTravelTipsInput): Promise<ChinaTravelResult> {
    return this.queryTripGenie(input.question, input.locale ?? "en", "query");
  }
}
