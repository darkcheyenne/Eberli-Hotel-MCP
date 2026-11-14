import { describe, expect, it, vi } from "vitest";
import { GooglePlacesProvider } from "../src/providers/google-places.js";
import { TtlCache } from "../src/utils/cache.js";

describe("GooglePlacesProvider", () => {
  it("sends required X-Goog-Api-Key and X-Goog-FieldMask headers for Text Search", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          places: [
            {
              id: "ChIJ123",
              name: "places/ChIJ123",
              displayName: { text: "Baur au Lac", languageCode: "en" },
              formattedAddress: "Talstrasse 1, 8001 Zürich, Switzerland",
              rating: 4.8,
              userRatingCount: 2150,
              priceLevel: "PRICE_LEVEL_VERY_EXPENSIVE",
              editorialSummary: { text: "Historic luxury hotel by the lake." },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const provider = new GooglePlacesProvider({
      apiKey: "gp-test-key",
      cache: new TtlCache({ ttlSeconds: 60 }),
      fetchImpl: fetchMock,
    });

    const result = await provider.searchText({
      textQuery: "Baur au Lac Zurich",
      includedType: "lodging",
      maxResultCount: 5,
    });

    expect(result.places).toHaveLength(1);
    expect(result.places[0]).toMatchObject({
      placeId: "ChIJ123",
      name: "Baur au Lac",
      priceTier: "$$$$",
      editorialSummary: "Historic luxury hotel by the lake.",
      rating: {
        provider: "google_places",
        rawScore: 4.8,
        normalizedOutOf5: 4.8,
        normalizedOutOf100: 96,
        reviewCount: 2150,
      },
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://places.googleapis.com/v1/places:searchText");
    expect(init?.headers).toMatchObject({
      "X-Goog-Api-Key": "gp-test-key",
    });
    const fieldMask = (init?.headers as Record<string, string>)["X-Goog-FieldMask"];
    expect(fieldMask).toContain("places.displayName");
    expect(fieldMask).toContain("places.rating");
  });

  it("supports nearby search, place details with reviews, and photo URL resolution", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            places: [{ id: "ChIJnearby", displayName: { text: "Nearby Inn" }, rating: 4.2 }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "ChIJnearby",
            displayName: { text: "Nearby Inn" },
            rating: 4.2,
            userRatingCount: 80,
            reviews: [
              {
                name: "places/ChIJnearby/reviews/r1",
                rating: 4,
                relativePublishTimeDescription: "a week ago",
                text: { text: "Cozy rooms.", languageCode: "en" },
                authorAttribution: { displayName: "Alice" },
              },
            ],
            photos: [{ name: "places/ChIJnearby/photos/p1", widthPx: 1600, heightPx: 1200 }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            name: "places/ChIJnearby/photos/p1",
            photoUri: "https://lh3.googleusercontent.com/places/photo123",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    const provider = new GooglePlacesProvider({
      apiKey: "gp-test-key",
      cache: new TtlCache({ ttlSeconds: 60 }),
      fetchImpl: fetchMock,
    });

    const nearby = await provider.searchNearby({
      latitude: 47.3769,
      longitude: 8.5417,
      radiusMeters: 1500,
      includedTypes: ["lodging"],
    });
    expect(nearby.places[0]?.placeId).toBe("ChIJnearby");

    const details = await provider.getPlaceDetails({
      placeId: "places/ChIJnearby",
      includeReviews: true,
      includePhotos: true,
    });
    expect(details.place.reviews?.[0]).toMatchObject({
      provider: "google_places",
      author: "Alice",
      ratingOutOf5: 4,
      text: "Cozy rooms.",
    });
    expect(details.place.photos?.[0]?.name).toBe("places/ChIJnearby/photos/p1");

    const photo = await provider.getPlacePhotoUrl({
      photoName: "places/ChIJnearby/photos/p1",
      maxWidthPx: 800,
    });
    expect(photo.photoUri).toBe("https://lh3.googleusercontent.com/places/photo123");
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("skipHttpRedirect=true");
  });
});
