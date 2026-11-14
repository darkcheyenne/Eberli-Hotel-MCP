export type CanonicalProvider = "tripadvisor_terra" | "google_places" | "china_travel";

export type PriceTier = "free" | "$" | "$$" | "$$$" | "$$$$" | "unknown";

export interface NormalizedRating {
  provider: CanonicalProvider;
  rawScore: number;
  rawScaleMax: number;
  normalizedOutOf5: number;
  normalizedOutOf100: number;
  reviewCount?: number;
}

export interface NormalizedReview {
  provider: Exclude<CanonicalProvider, "china_travel">;
  id?: string;
  author?: string;
  ratingOutOf5?: number;
  title?: string;
  text?: string;
  publishedAt?: string;
  relativeTime?: string;
  tripType?: string;
  language?: string;
  subratings?: Record<string, number>;
}

export interface ConsensusRating {
  scoreOutOf5: number;
  scoreOutOf100: number;
  totalReviews: number;
  providerCount: number;
  weightingMethod: "review_count_weighted" | "equal_weight";
}

export interface ChinaTravelTextHighlights {
  extractedRatingsOutOf5: number[];
  extractedPrices: string[];
  bookingUrls: string[];
}

function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * Parses numeric or string numbers safely (TripAdvisor Terra often serializes rating/num_reviews as strings).
 */
export function toOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed.replace(/,/g, ""));
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

/**
 * Normalizes a rating value from any scale (default 5) into both a 0-5 and 0-100 scale.
 */
export function normalizeRating(
  provider: CanonicalProvider,
  rawValue: unknown,
  rawScaleMax = 5,
  reviewCountValue?: unknown,
): NormalizedRating | undefined {
  const rawScore = toOptionalNumber(rawValue);
  if (rawScore === undefined || rawScaleMax <= 0 || rawScore < 0) {
    return undefined;
  }

  const clampedRatio = Math.min(1, rawScore / rawScaleMax);
  const reviewCount = toOptionalNumber(reviewCountValue);

  return {
    provider,
    rawScore,
    rawScaleMax,
    normalizedOutOf5: roundTo(clampedRatio * 5, 2),
    normalizedOutOf100: roundTo(clampedRatio * 100, 1),
    reviewCount: reviewCount !== undefined && reviewCount >= 0 ? Math.round(reviewCount) : undefined,
  };
}

/**
 * Normalizes price level representations across Google Places enums and TripAdvisor price strings.
 */
export function normalizePriceLevel(rawPrice: unknown): PriceTier {
  if (typeof rawPrice !== "string" || rawPrice.trim().length === 0) {
    return "unknown";
  }

  const normalized = rawPrice.trim().toUpperCase();
  switch (normalized) {
    case "PRICE_LEVEL_FREE":
    case "FREE":
      return "free";
    case "PRICE_LEVEL_INEXPENSIVE":
    case "$":
    case "1":
      return "$";
    case "PRICE_LEVEL_MODERATE":
    case "$$":
    case "$ - $$":
    case "2":
      return "$$";
    case "PRICE_LEVEL_EXPENSIVE":
    case "$$$":
    case "$$ - $$$":
    case "3":
      return "$$$";
    case "PRICE_LEVEL_VERY_EXPENSIVE":
    case "$$$$":
    case "$$$ - $$$$":
    case "4":
      return "$$$$";
    default: {
      const dollarRuns = normalized.match(/\$+/g);
      if (dollarRuns && dollarRuns.length > 0) {
        const maxLen = Math.max(...dollarRuns.map((run) => run.length));
        if (maxLen === 1) return "$";
        if (maxLen === 2) return "$$";
        if (maxLen === 3) return "$$$";
        if (maxLen >= 4) return "$$$$";
      }
      return "unknown";
    }
  }
}

/**
 * Computes a weighted consensus rating across multiple providers.
 * Prefers review-count weighting when at least one provider supplies a positive review count.
 */
export function computeConsensusRating(ratings: NormalizedRating[]): ConsensusRating | undefined {
  if (ratings.length === 0) return undefined;

  const totalPositiveReviews = ratings.reduce(
    (sum, item) => sum + (item.reviewCount && item.reviewCount > 0 ? item.reviewCount : 0),
    0,
  );

  if (totalPositiveReviews > 0) {
    const weightedSum5 = ratings.reduce((sum, item) => {
      const weight = item.reviewCount && item.reviewCount > 0 ? item.reviewCount : 1;
      return sum + item.normalizedOutOf5 * weight;
    }, 0);
    const totalWeight = ratings.reduce(
      (sum, item) => sum + (item.reviewCount && item.reviewCount > 0 ? item.reviewCount : 1),
      0,
    );
    const scoreOutOf5 = roundTo(weightedSum5 / totalWeight, 2);
    return {
      scoreOutOf5,
      scoreOutOf100: roundTo((scoreOutOf5 / 5) * 100, 1),
      totalReviews: totalPositiveReviews,
      providerCount: ratings.length,
      weightingMethod: "review_count_weighted",
    };
  }

  const mean5 =
    ratings.reduce((sum, item) => sum + item.normalizedOutOf5, 0) / ratings.length;
  const scoreOutOf5 = roundTo(mean5, 2);
  return {
    scoreOutOf5,
    scoreOutOf100: roundTo((scoreOutOf5 / 5) * 100, 1),
    totalReviews: 0,
    providerCount: ratings.length,
    weightingMethod: "equal_weight",
  };
}

/**
 * Extracts structured signals (URLs, price mentions, 5-star ratings) from TripGenie markdown/text output.
 */
export function parseChinaTravelHighlights(text: string): ChinaTravelTextHighlights {
  const urlMatches = text.match(/https?:\/\/[^\s)>\]"']+/gi) ?? [];
  const bookingUrls = Array.from(new Set(urlMatches));

  const priceMatches =
    text.match(/(?:USD|US\$|\$|CNY|RMB|¥)\s?\d[\d,]*(?:\.\d{1,2})?(?:\s*[-–~]\s*(?:USD|US\$|\$|CNY|RMB|¥)?\s?\d[\d,]*(?:\.\d{1,2})?)?/gi) ??
    [];
  const extractedPrices = Array.from(new Set(priceMatches.map((p) => p.trim())));

  const ratingMatches: number[] = [];
  const ratingRegex = /(\d(?:\.\d{1,2})?)\s*(?:\/\s*5(?:\.0)?|out of 5)/gi;
  for (const match of text.matchAll(ratingRegex)) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value >= 0 && value <= 5) {
      ratingMatches.push(value);
    }
  }

  return {
    extractedRatingsOutOf5: Array.from(new Set(ratingMatches)),
    extractedPrices,
    bookingUrls,
  };
}
