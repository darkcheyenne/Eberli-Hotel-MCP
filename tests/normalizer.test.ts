import { describe, expect, it } from "vitest";
import {
  computeConsensusRating,
  normalizePriceLevel,
  normalizeRating,
  parseChinaTravelHighlights,
} from "../src/utils/normalizer.js";

describe("normalizer", () => {
  it("normalizes numeric and string ratings onto 0-5 and 0-100 scales", () => {
    const taRating = normalizeRating("tripadvisor_terra", "4.5", 5, "1,250");
    expect(taRating).toEqual({
      provider: "tripadvisor_terra",
      rawScore: 4.5,
      rawScaleMax: 5,
      normalizedOutOf5: 4.5,
      normalizedOutOf100: 90,
      reviewCount: 1250,
    });

    const customScale = normalizeRating("google_places", 8.6, 10, 200);
    expect(customScale?.normalizedOutOf5).toBe(4.3);
    expect(customScale?.normalizedOutOf100).toBe(86);

    expect(normalizeRating("tripadvisor_terra", undefined, 5)).toBeUndefined();
  });

  it("normalizes Google Places enums and TripAdvisor price strings", () => {
    expect(normalizePriceLevel("PRICE_LEVEL_INEXPENSIVE")).toBe("$");
    expect(normalizePriceLevel("PRICE_LEVEL_MODERATE")).toBe("$$");
    expect(normalizePriceLevel("PRICE_LEVEL_EXPENSIVE")).toBe("$$$");
    expect(normalizePriceLevel("PRICE_LEVEL_VERY_EXPENSIVE")).toBe("$$$$");
    expect(normalizePriceLevel("$$ - $$$")).toBe("$$$");
    expect(normalizePriceLevel(undefined)).toBe("unknown");
  });

  it("computes review-count weighted consensus rating", () => {
    const ta = normalizeRating("tripadvisor_terra", 4.0, 5, 100)!;
    const gp = normalizeRating("google_places", 4.8, 5, 900)!;

    const consensus = computeConsensusRating([ta, gp]);
    expect(consensus).toEqual({
      scoreOutOf5: 4.72,
      scoreOutOf100: 94.4,
      totalReviews: 1000,
      providerCount: 2,
      weightingMethod: "review_count_weighted",
    });
  });

  it("extracts ratings, prices, and booking URLs from China Travel text", () => {
    const sample = `
1. **The Peninsula Shanghai** — Rating: 4.8/5, Price: $320-450/night
Book here: https://www.trip.com/hotels/shanghai-hotel-detail-12345/?allianceid=8405769
2. **Peace Hotel** — 4.6 out of 5, ¥1,800/night
`;
    const highlights = parseChinaTravelHighlights(sample);
    expect(highlights.extractedRatingsOutOf5).toEqual([4.8, 4.6]);
    expect(highlights.extractedPrices).toContain("$320-450");
    expect(highlights.extractedPrices).toContain("¥1,800");
    expect(highlights.bookingUrls).toEqual([
      "https://www.trip.com/hotels/shanghai-hotel-detail-12345/?allianceid=8405769",
    ]);
  });
});
