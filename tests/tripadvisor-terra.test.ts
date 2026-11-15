import { describe, expect, it, vi } from "vitest";
import { TripAdvisorTerraProvider } from "../src/providers/tripadvisor-terra.js";
import { TtlCache } from "../src/utils/cache.js";
import { HttpError } from "../src/utils/http.js";

describe("TripAdvisorTerraProvider", () => {
  it("handles omitted fields defensively without assuming nulls", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          location_id: 12345,
          name: "Minimal Boutique Hotel",
          // description, phone, website, price_level, subratings, ranking_data omitted
          rating: "4.6",
          num_reviews: "42",
          address_obj: {
            city: "Zurich",
            country: "Switzerland",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const provider = new TripAdvisorTerraProvider({
      apiKey: "terra-test-key",
      cache: new TtlCache({ ttlSeconds: 60 }),
      fetchImpl: fetchMock,
    });

    const result = await provider.getLocationDetails("12345", "en");
    expect(result.location).toEqual({
      locationId: "12345",
      name: "Minimal Boutique Hotel",
      description: undefined,
      address: "Zurich, Switzerland",
      city: "Zurich",
      country: "Switzerland",
      latitude: undefined,
      longitude: undefined,
      webUrl: undefined,
      website: undefined,
      phone: undefined,
      priceTier: "unknown",
      rawPriceLevel: undefined,
      rating: {
        provider: "tripadvisor_terra",
        rawScore: 4.6,
        rawScaleMax: 5,
        normalizedOutOf5: 4.6,
        normalizedOutOf100: 92,
        reviewCount: 42,
      },
      category: undefined,
      ranking: undefined,
      amenities: undefined,
      subratings: undefined,
      matchedValue: undefined,
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("https://terra.tripadvisor.com/api/locations/12345");
    expect(String(url)).toContain("version=1");
    expect(String(url)).toContain("locale=en");
    expect(init?.headers).toMatchObject({
      "X-API-Key": "terra-test-key",
      Accept: "application/json, application/problem+json",
    });
  });

  it("handles HTTP 404 with a clear allowlist-aware actionable error message", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          title: "Not Found",
          status: 404,
          detail: "Location 999999 not found on allowlist",
        }),
        { status: 404, headers: { "Content-Type": "application/problem+json" } },
      ),
    );

    const provider = new TripAdvisorTerraProvider({
      apiKey: "terra-test-key",
      maxRetries: 0,
      cache: new TtlCache({ ttlSeconds: 60 }),
      fetchImpl: fetchMock,
    });

    await expect(provider.getLocationDetails("999999")).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(HttpError);
      const httpErr = err as HttpError;
      expect(httpErr.status).toBe(404);
      expect(httpErr.message).toContain("allowlist");
      expect(httpErr.actionableHint).toContain("ta_search_catalog");
      return true;
    });

    // Second call for the same non-allowlisted ID must hit negative cache without a network request
    await expect(provider.getLocationDetails("999999")).rejects.toMatchObject({
      status: 404,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("parses catalog search, reviews with subratings, and photos", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ location_id: "777", name: "Grand Palace Hotel", address_obj: { city: "Beijing" } }],
            pagination: { page: 1, size: 10, total_elements: 1, total_pages: 1 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 501,
                title: "Wonderful stay",
                text: "Clean rooms and great service.",
                rating: 5,
                trip_type: "business",
                published_date: "2026-10-10",
                user: { username: "traveler_one" },
                subratings: [{ type_name: "Cleanliness", value: "5.0" }],
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 801,
                caption: "Lobby",
                original_size_url: "https://media-cdn.tripadvisor.com/photo.jpg",
                source: { localized_name: "Management" },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    const provider = new TripAdvisorTerraProvider({
      apiKey: "terra-test-key",
      cache: new TtlCache({ ttlSeconds: 60 }),
      fetchImpl: fetchMock,
    });

    const catalog = await provider.searchCatalog({ query: "Grand Palace", category: "HOTEL" });
    expect(catalog.locations).toHaveLength(1);
    expect(catalog.locations[0]?.locationId).toBe("777");

    const reviews = await provider.getLocationReviews({
      locationId: "777",
      rating_min: 4,
      trip_type: "business",
      sort_by: "MOST_RECENT",
    });
    expect(reviews.reviews[0]).toMatchObject({
      provider: "tripadvisor_terra",
      author: "traveler_one",
      ratingOutOf5: 5,
      subratings: { Cleanliness: 5 },
    });

    const photos = await provider.getLocationPhotos("777");
    expect(photos.photos[0]?.url).toBe("https://media-cdn.tripadvisor.com/photo.jpg");
  });

  it("parses nested Terra v1 location, review, and photo payload shapes", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                location: {
                  id: 196060,
                  names: [
                    { language: "en", value: "baur au lac zürich", primary: false },
                    { language: "en", value: "Baur Au Lac", primary: true },
                  ],
                  descriptions: [{ language: "en", value: "Historic hotel since 1844." }],
                  addresses: [
                    {
                      street_address: "Talstrasse 1",
                      city: "Zurich",
                      country_name: "Switzerland",
                      postal_code: "8001",
                      formatted: "Talstrasse 1, Zurich 8001 Switzerland",
                    },
                  ],
                  coordinates: { latitude: 47.367364, longitude: 8.539124 },
                  overall_rating: { rating: 4.7, count: 1206 },
                  urls: {
                    tripadvisor: { main: "https://www.tripadvisor.com/Hotel_Review-d196060" },
                    official: "http://www.bauraulac.ch",
                  },
                },
              },
            ],
            pagination: { page: 1, size: 1, total_pages: 1, total_elements: 1 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 1084154727,
                publish_ts: "2026-11-02T15:34:49.784Z",
                rating: 5,
                trip_type: "FRIENDS",
                user: { username: "michaelnZ9512YY" },
                title: [{ language: "en", value: "Serenity", primary: true }],
                text: [{ language: "en", value: "Excellent location.", primary: true }],
                subratings: [{ type: "RATE_CLEANLINESS", rating: 5, type_name: "Cleanliness" }],
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 411812385,
                photo: {
                  original_size_url: "https://dynamic-media.tacdn.com/media/photo-o/sample.jpg",
                },
                publish_ts: "2019-07-28T19:51:48.103Z",
                source: { name: "Management" },
                caption: "Dahlia Cottage",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    const provider = new TripAdvisorTerraProvider({
      apiKey: "terra-test-key",
      cache: new TtlCache({ ttlSeconds: 60 }),
      fetchImpl: fetchMock,
    });

    const catalog = await provider.searchCatalog({ query: "Baur Au Lac" });
    expect(catalog.locations[0]).toMatchObject({
      locationId: "196060",
      name: "Baur Au Lac",
      address: "Talstrasse 1, Zurich 8001 Switzerland",
      city: "Zurich",
      country: "Switzerland",
      latitude: 47.367364,
      longitude: 8.539124,
      webUrl: "https://www.tripadvisor.com/Hotel_Review-d196060",
      website: "http://www.bauraulac.ch",
      rating: {
        rawScore: 4.7,
        normalizedOutOf5: 4.7,
        normalizedOutOf100: 94,
        reviewCount: 1206,
      },
    });

    const reviews = await provider.getLocationReviews({ locationId: 196060 });
    expect(reviews.reviews[0]).toMatchObject({
      id: "1084154727",
      title: "Serenity",
      text: "Excellent location.",
      publishedAt: "2026-11-02T15:34:49.784Z",
      subratings: { Cleanliness: 5 },
    });

    const photos = await provider.getLocationPhotos(196060);
    expect(photos.photos[0]).toMatchObject({
      id: "411812385",
      url: "https://dynamic-media.tacdn.com/media/photo-o/sample.jpg",
      publishedDate: "2019-07-28T19:51:48.103Z",
    });
  });
});
