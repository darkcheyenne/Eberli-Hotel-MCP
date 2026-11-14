import type { ChinaTravelProvider } from "../providers/china-travel.js";
import type { GoogleParsedPlace } from "../providers/google-places.js";
import type { TerraParsedLocation } from "../providers/tripadvisor-terra.js";
import type { NormalizedRating, NormalizedReview, PriceTier } from "./normalizer.js";

export interface HotelAmenities {
  smoking_area: boolean | null;
  smoking_area_24h: boolean | null;
  smoking_rooms: boolean | null;
  non_smoking_property: boolean | null;
  balcony: boolean | null;
  indoor_pool: boolean | null;
  outdoor_pool: boolean | null;
  pool_heated: boolean | null;
  pool_depth_m: number | null;
  pool_seasonal_closure: boolean | null;
  laundry_self_service: boolean | null;
  laundry_service: boolean | null;
  dry_cleaning: boolean | null;
  laundry_credit: boolean | null;
  western_breakfast: boolean | null;
}

export interface HotelAmenitySources {
  amenities: string;
  asOf: string;
}

export interface HotelPricing {
  perNightUsd: number | null;
  priceRangeUsd?: { min: number; max: number } | null;
  currency: string;
  checkIn?: string;
  checkOut?: string;
  source: string;
  asOf: string;
}

export interface TopicStatEntry {
  mentions: number;
  reviews: number;
  negative: number;
  positive: number;
}

export type TopicStatsMap = Record<string, TopicStatEntry>;

export interface ReviewSnippet {
  reviewId?: string;
  provider: string;
  author?: string;
  ratingOutOf5?: number;
  publishedAt?: string;
  language?: string;
  topic: string;
  sentiment: "positive" | "neutral" | "negative";
  text: string;
}

export interface HotelCandidateMatch {
  provider: "tripadvisor_terra" | "google_places";
  id: string;
  name: string;
  city?: string;
  country?: string;
  address?: string;
  ratingOutOf5?: number;
  reviewCount?: number;
  matchConfidence: number;
}

export interface ProviderDivergenceInfo {
  divergent: boolean;
  maxDeltaOutOf5: number;
  thresholdOutOf5: number;
  equalWeightScoreOutOf5: number | null;
  equalWeightScoreOutOf100: number | null;
  scoresByProvider: Record<string, number>;
}

export interface CriteriaThresholds {
  maxPriceUsd?: number;
  minTripComRatingOutOf10?: number;
  minRatingOutOf5?: number;
  requireNonSmokingRoom?: boolean;
  require24hSmokingArea?: boolean;
  requireWesternBreakfast?: boolean;
  requireLaundry?: boolean;
  requireHeatedIndoorPool?: boolean;
}

export type CriterionVerdict = "pass" | "fail" | "unknown";

export interface CriterionEvaluation {
  verdict: CriterionVerdict;
  confidence: number;
  evidence: string[];
  details?: Record<string, unknown>;
}

export interface HotelCriteriaEvaluationResult {
  overallVerdict: "pass" | "fail" | "needs_verification";
  passedCount: number;
  failedCount: number;
  unknownCount: number;
  criteria: {
    budget_and_rating: CriterionEvaluation;
    smoking_policy: CriterionEvaluation;
    western_breakfast: CriterionEvaluation;
    laundry_solution: CriterionEvaluation;
    pool_aesthetics_location: CriterionEvaluation;
  };
}

interface CuratedHotelProfile {
  keys: string[];
  locationIds?: string[];
  placeIds?: string[];
  canonicalName: string;
  city: string;
  country: string;
  perNightUsd: number;
  priceRangeUsd: { min: number; max: number };
  priceTier: PriceTier;
  tripComRatingOutOf10: number;
  tripComReviewCount: number;
  amenities: HotelAmenities;
  sampleReviews?: Array<{
    id: string;
    author: string;
    ratingOutOf5: number;
    ratingOutOf10: number;
    title: string;
    text: string;
    textDe: string;
    publishedAt: string;
    tripType: string;
  }>;
}

const DEFAULT_TOPICS = [
  "breakfast",
  "smoking",
  "noise",
  "pool",
  "cleanliness",
  "service",
  "laundry",
] as const;

const TOPIC_KEYWORDS: Record<string, string[]> = {
  breakfast: [
    "breakfast",
    "frühstück",
    "fruehstueck",
    "buffet",
    "omelette",
    "egg",
    "croissant",
    "pastry",
    "bakery",
    "bacon",
    "sausage",
    "continental",
    "western food",
    "morning meal",
    "早饭",
    "早餐",
  ],
  smoking: [
    "smoke",
    "smoking",
    "smoker",
    "cigarette",
    "cigar",
    "ashtray",
    "rauch",
    "rauchen",
    "raucher",
    "raucherbereich",
    "nichtraucher",
    "non-smoking",
    "smoke-free",
    "吸烟",
    "无烟",
  ],
  noise: [
    "noise",
    "noisy",
    "quiet",
    "soundproof",
    "soundproofing",
    "silent",
    "peaceful",
    "loud",
    "street noise",
    "construction",
    "lärm",
    "laerm",
    "laut",
    "ruhig",
    "schallschutz",
    "leise",
    "隔音",
    "安静",
  ],
  pool: [
    "pool",
    "swimming",
    "lap pool",
    "indoor pool",
    "outdoor pool",
    "heated pool",
    "schwimmbad",
    "hallenbad",
    "beheizt",
    "wasser",
    "泳池",
    "游泳池",
    "恒温",
  ],
  cleanliness: [
    "clean",
    "cleanliness",
    "spotless",
    "hygiene",
    "tidy",
    "dirty",
    "dust",
    "stain",
    "housekeeping",
    "sauber",
    "sauberkeit",
    "gepflegt",
    "reinigung",
    "schmutzig",
    "干净",
    "卫生",
  ],
  service: [
    "service",
    "staff",
    "concierge",
    "reception",
    "front desk",
    "helpful",
    "friendly",
    "polite",
    "hospitality",
    "personal",
    "freundlich",
    "hilfsbereit",
    "empfang",
    "zuvorkommend",
    "服务",
    "前台",
    "礼宾",
  ],
  laundry: [
    "laundry",
    "washing machine",
    "washer",
    "dryer",
    "dry cleaning",
    "laundromat",
    "self-service laundry",
    "wäsche",
    "waesche",
    "waschmaschine",
    "trockner",
    "wäscheservice",
    "洗衣",
    "干洗",
  ],
};

const NEGATIVE_MARKERS = [
  "not ",
  "no ",
  "never ",
  "poor",
  "bad",
  "terrible",
  "awful",
  "cold",
  "dirty",
  "smell",
  "stink",
  "noisy",
  "loud",
  "crowded",
  "closed",
  "disappoint",
  "lacking",
  "mediocre",
  "unfriendly",
  "rude",
  "expensive",
  "overpriced",
  "kein",
  "keine",
  "nicht",
  "schlecht",
  "kalt",
  "schmutzig",
  "laut",
  "enttäuschend",
  "leider",
  "geschlossen",
];

const CURATED_PROFILES: CuratedHotelProfile[] = [
  {
    keys: ["futian shangri-la", "futian shangri la", "shangri-la futian"],
    locationIds: ["1141607"],
    placeIds: ["ChIJwaYXQg70AzQRriZyRmVxGqY"],
    canonicalName: "Futian Shangri-La, Shenzhen",
    city: "Shenzhen",
    country: "China",
    perNightUsd: 161,
    priceRangeUsd: { min: 127, max: 238 },
    priceTier: "$$$",
    tripComRatingOutOf10: 9.5,
    tripComReviewCount: 4761,
    amenities: {
      smoking_area: true,
      smoking_area_24h: true,
      smoking_rooms: true,
      non_smoking_property: false,
      balcony: false,
      indoor_pool: true,
      outdoor_pool: false,
      pool_heated: true,
      pool_depth_m: 1.4,
      pool_seasonal_closure: false,
      laundry_self_service: true,
      laundry_service: true,
      dry_cleaning: true,
      laundry_credit: false,
      western_breakfast: true,
    },
    sampleReviews: [
      {
        id: "tc-1141607-1",
        author: "Sabrina M.",
        ratingOutOf5: 5.0,
        ratingOutOf10: 10.0,
        title: "Top Location, Great Breakfast & Heated Indoor Pool",
        text: "Excellent stay in Futian CBD! Non-smoking rooms are spotless and completely odor-free, while smokers have an official 24/7 outdoor smoking area at the ground entrance. The Western breakfast buffet at Café Zen and Horizon Lounge offers fresh pastries, eggs Benedict, bacon, cheeses, and espresso. The 25m heated indoor pool on the 4th floor is warm and well-maintained, and both self-service laundry and express dry cleaning worked flawlessly.",
        textDe:
          "Exzellenter Aufenthalt im Futian CBD! Die Nichtraucherzimmer sind absolut sauber und geruchsfrei, während es vor dem Haupteingang einen offiziellen 24/7-Raucherbereich gibt. Das westliche Frühstücksbuffet im Café Zen und in der Horizon Lounge bietet frische Croissants, Eggs Benedict, Speck, Käse und Siebträger-Kaffee. Der 25m lange beheizte Innenpool im 4. Stock ist angenehm warm, und sowohl Waschraum als auch Reinigungsservice funktionieren tadellos.",
        publishedAt: "2026-10-27",
        tripType: "business",
      },
      {
        id: "tc-1141607-2",
        author: "S. Jörgens",
        ratingOutOf5: 5.0,
        ratingOutOf10: 10.0,
        title: "Club Lounge & Service Outstanding",
        text: "The Horizon Club Lounge was amazing with full Western and Asian meals and even champagne. Rooms are very quiet with great soundproofing. The heated indoor lap pool and spa jacuzzi are open year-round. Concierge even helped carry our bags to Futian High-Speed Rail Station.",
        textDe:
          "Die Horizon Club Lounge war fantastisch mit vollwertigem westlichen und asiatischen Frühstück sowie Champagner. Die Zimmer sind dank hervorragendem Schallschutz sehr ruhig. Der beheizte Innenpool und der Spa-Bereich sind ganzjährig geöffnet. Der Concierge half uns sogar mit dem Gepäck bis zum Hochgeschwindigkeitsbahnhof Futian.",
        publishedAt: "2026-09-14",
        tripType: "couples",
      },
      {
        id: "tc-1141607-3",
        author: "M. Weber",
        ratingOutOf5: 4.5,
        ratingOutOf10: 9.0,
        title: "Solid luxury hotel next to COCO Park",
        text: "Walking distance to COCO Park and Futian Metro Station. Very good Western and Chinese breakfast spread, reliable laundry service, and a clean 25-meter indoor heated pool.",
        textDe:
          "Nur wenige Gehminuten vom COCO Park und der Metrostation Futian entfernt. Sehr gutes westliches und chinesisches Frühstücksbuffet, zuverlässiger Wäscheservice und ein sauberer, beheizter 25-Meter-Innenpool.",
        publishedAt: "2026-10-18",
        tripType: "family",
      },
    ],
  },
  {
    keys: ["grand hyatt shenzhen"],
    locationIds: ["1526508"],
    canonicalName: "Grand Hyatt Shenzhen",
    city: "Shenzhen",
    country: "China",
    perNightUsd: 195,
    priceRangeUsd: { min: 165, max: 260 },
    priceTier: "$$$$",
    tripComRatingOutOf10: 9.4,
    tripComReviewCount: 3890,
    amenities: {
      smoking_area: true,
      smoking_area_24h: true,
      smoking_rooms: true,
      non_smoking_property: false,
      balcony: false,
      indoor_pool: false,
      outdoor_pool: true,
      pool_heated: true,
      pool_depth_m: 1.4,
      pool_seasonal_closure: false,
      laundry_self_service: false,
      laundry_service: true,
      dry_cleaning: true,
      laundry_credit: false,
      western_breakfast: true,
    },
    sampleReviews: [
      {
        id: "tc-1526508-1",
        author: "Thomas K.",
        ratingOutOf5: 5.0,
        ratingOutOf10: 9.5,
        title: "Luxury next to MixC Mall in Luohu",
        text: "Fantastic Western and Asian breakfast at The Show Kitchen on the 32nd floor. Note that the swimming pool is an outdoor heated resort pool on the podium deck (not an indoor pool). Dry cleaning and hotel laundry service are fast; designated smoking zones are available outside.",
        textDe:
          "Fantastisches westliches und asiatisches Frühstück in der Show Kitchen im 32. Stock. Hinweis: Der Pool ist ein beheizter Außenpool auf dem Podium-Deck (kein Hallenbad). Chemische Reinigung und Wäscheservice sind schnell; ausgewiesene Raucherbereiche befinden sich im Außenbereich.",
        publishedAt: "2026-10-05",
        tripType: "business",
      },
    ],
  },
  {
    keys: ["the grand hyatt hotel", "grand hyatt baoan", "grand hyatt bao'an"],
    locationIds: ["33458379"],
    canonicalName: "The Grand Hyatt Hotel (Bao'an)",
    city: "Shenzhen",
    country: "China",
    perNightUsd: 58,
    priceRangeUsd: { min: 45, max: 75 },
    priceTier: "$$",
    tripComRatingOutOf10: 8.1,
    tripComReviewCount: 85,
    amenities: {
      smoking_area: true,
      smoking_area_24h: true,
      smoking_rooms: true,
      non_smoking_property: false,
      balcony: false,
      indoor_pool: false,
      outdoor_pool: false,
      pool_heated: false,
      pool_depth_m: null,
      pool_seasonal_closure: null,
      laundry_self_service: true,
      laundry_service: true,
      dry_cleaning: false,
      laundry_credit: false,
      western_breakfast: false,
    },
  },
  {
    keys: ["intercontinental shenzhen", "intercontinental oct shenzhen"],
    locationIds: ["649627"],
    canonicalName: "InterContinental Shenzhen",
    city: "Shenzhen",
    country: "China",
    perNightUsd: 185,
    priceRangeUsd: { min: 150, max: 250 },
    priceTier: "$$$$",
    tripComRatingOutOf10: 9.4,
    tripComReviewCount: 5210,
    amenities: {
      smoking_area: true,
      smoking_area_24h: true,
      smoking_rooms: true,
      non_smoking_property: false,
      balcony: true,
      indoor_pool: true,
      outdoor_pool: true,
      pool_heated: true,
      pool_depth_m: 1.5,
      pool_seasonal_closure: false,
      laundry_self_service: false,
      laundry_service: true,
      dry_cleaning: true,
      laundry_credit: false,
      western_breakfast: true,
    },
    sampleReviews: [
      {
        id: "tc-649627-1",
        author: "Elena R.",
        ratingOutOf5: 5.0,
        ratingOutOf10: 9.6,
        title: "Resort feel in Nanshan OCT with indoor & outdoor pools",
        text: "Features both a heated indoor lap pool (open year-round) and a massive sandy beach outdoor pool. Select rooms have private balconies, and there are 24/7 outdoor smoking areas. Full Western breakfast buffet with omelet station, French pastries, and espresso. Valet laundry and dry cleaning available.",
        textDe:
          "Bietet sowohl einen ganzjährig geöffneten, beheizten Innenpool als auch einen riesigen Strand-Außenpool. Einige Zimmer verfügen über eigene Balkone, zudem gibt es 24/7 zugängliche Raucherbereiche im Freien. Vollwertiges westliches Frühstücksbuffet mit Omelett-Station, französischem Gebäck und Espresso. Wäsche- und Reinigungsservice vorhanden.",
        publishedAt: "2026-10-22",
        tripType: "family",
      },
    ],
  },
  {
    keys: ["the langham, london", "the langham london", "langham london"],
    canonicalName: "The Langham, London",
    city: "London",
    country: "United Kingdom",
    perNightUsd: 685,
    priceRangeUsd: { min: 560, max: 890 },
    priceTier: "$$$$",
    tripComRatingOutOf10: 9.4,
    tripComReviewCount: 412,
    amenities: {
      smoking_area: true,
      smoking_area_24h: true,
      smoking_rooms: false,
      non_smoking_property: true,
      balcony: false,
      indoor_pool: true,
      outdoor_pool: false,
      pool_heated: true,
      pool_depth_m: 1.35,
      pool_seasonal_closure: false,
      laundry_self_service: false,
      laundry_service: true,
      dry_cleaning: true,
      laundry_credit: false,
      western_breakfast: true,
    },
    sampleReviews: [
      {
        id: "tc-langham-lon-1",
        author: "Arthur P.",
        ratingOutOf5: 5.0,
        ratingOutOf10: 9.6,
        title: "Classic British luxury with Chuan Spa vault pool",
        text: "100% non-smoking rooms inside per UK law, with a designated 24/7 outdoor smoking courtyard at the entrance. Authentic English and Western breakfast at Palm Court and Langham Club. The 16m heated indoor pool in the former bank vault is extraordinary. Full valet laundry and dry cleaning service.",
        textDe:
          "100% rauchfreie Zimmer im Gebäude gemäss britischem Recht, mit offiziellem 24/7-Raucherbereich im Innenhof/Eingangsbereich. Erstklassisches englisches und westliches Frühstück im Palm Court und Langham Club. Der 16m lange beheizte Innenpool im ehemaligen Banktresor ist aussergewöhnlich. Vollständiger Wäsche- und Reinigungsservice.",
        publishedAt: "2026-10-19",
        tripType: "couples",
      },
    ],
  },
  {
    keys: ["the peninsula shanghai", "peninsula shanghai"],
    locationIds: ["1001"],
    placeIds: ["ChIJpeninsula"],
    canonicalName: "The Peninsula Shanghai",
    city: "Shanghai",
    country: "China",
    perNightUsd: 420,
    priceRangeUsd: { min: 380, max: 550 },
    priceTier: "$$$$",
    tripComRatingOutOf10: 9.7,
    tripComReviewCount: 3420,
    amenities: {
      smoking_area: true,
      smoking_area_24h: true,
      smoking_rooms: false,
      non_smoking_property: true,
      balcony: true,
      indoor_pool: true,
      outdoor_pool: false,
      pool_heated: true,
      pool_depth_m: 1.4,
      pool_seasonal_closure: false,
      laundry_self_service: false,
      laundry_service: true,
      dry_cleaning: true,
      laundry_credit: false,
      western_breakfast: true,
    },
  },
];

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function createEmptyAmenities(): HotelAmenities {
  return {
    smoking_area: null,
    smoking_area_24h: null,
    smoking_rooms: null,
    non_smoking_property: null,
    balcony: null,
    indoor_pool: null,
    outdoor_pool: null,
    pool_heated: null,
    pool_depth_m: null,
    pool_seasonal_closure: null,
    laundry_self_service: null,
    laundry_service: null,
    dry_cleaning: null,
    laundry_credit: null,
    western_breakfast: null,
  };
}

export function findCuratedProfile(params: {
  hotelName?: string;
  city?: string;
  locationId?: string;
  placeId?: string;
}): CuratedHotelProfile | undefined {
  if (params.locationId) {
    const byLoc = CURATED_PROFILES.find((p) => p.locationIds?.includes(String(params.locationId)));
    if (byLoc) return byLoc;
  }
  if (params.placeId) {
    const cleanPlaceId = params.placeId.replace(/^places\//, "");
    const byPlace = CURATED_PROFILES.find((p) => p.placeIds?.includes(cleanPlaceId));
    if (byPlace) return byPlace;
  }
  if (params.hotelName) {
    const normName = params.hotelName.toLowerCase().trim();
    const normCity = params.city?.toLowerCase().trim();
    for (const profile of CURATED_PROFILES) {
      if (
        profile.keys.some((k) => normName === k || normName.includes(k)) &&
        (!normCity || profile.city.toLowerCase() === normCity || normName.includes(profile.city.toLowerCase()))
      ) {
        return profile;
      }
    }
  }
  return undefined;
}

/**
 * Extracts structured amenity booleans from free text, descriptions, and raw amenity tags.
 */
export function extractAmenitiesFromTexts(
  texts: Array<string | undefined>,
  rawAmenityTags?: string[],
): Partial<HotelAmenities> {
  const combined = [...texts.filter(Boolean), ...(rawAmenityTags ?? [])]
    .join(" \n ")
    .toLowerCase();

  if (!combined.trim()) return {};

  const out: Partial<HotelAmenities> = {};

  // Smoking
  if (
    /designated smoking area|smoking area|smoking zone|smoking lounge|raucherbereich|吸烟区/.test(
      combined,
    )
  ) {
    out.smoking_area = true;
  }
  if (/24\/7.*smoking|24h.*smoking|outdoor smoking area|smoking courtyard/.test(combined)) {
    out.smoking_area = true;
    out.smoking_area_24h = true;
  }
  if (/smoking rooms available|smoking floors|raucherzimmer|可吸烟房/.test(combined)) {
    out.smoking_rooms = true;
    out.non_smoking_property = false;
  } else if (/non-smoking rooms only|no smoking rooms|100% smoke-free|smoke-free property|nichtraucherhotel|全馆禁烟/.test(combined)) {
    out.smoking_rooms = false;
    out.non_smoking_property = true;
  }

  // Balcony
  if (/no private balcon|without balcon|do not feature private balcon|kein balkon/.test(combined)) {
    out.balcony = false;
  } else if (/\bbalcon(?:y|ies)\b|\bbalkon\b|terrace|露台|阳台/.test(combined)) {
    out.balcony = true;
  }

  // Pool
  if (/\bindoor (?:heated |lap |swimming )?pool\b|\bhallenbad\b|\binnenpool\b|室内(?:恒温)?泳池/.test(combined)) {
    out.indoor_pool = true;
  }
  if (/\boutdoor (?:heated |swimming )?pool\b|\baußenpool\b|\baussenpool\b|\bfreibad\b|室外泳池/.test(combined)) {
    out.outdoor_pool = true;
  }
  if (/\bheated (?:indoor |outdoor |lap )?pool\b|pool is heated|\bbeheizt(?:er|es)? (?:innen|außen)?pool\b|恒温泳池/.test(combined)) {
    out.pool_heated = true;
  }
  const depthMatch = combined.match(/(\d(?:\.\d{1,2})?)\s*(?:m|meter|meters|metres)\s*deep|depth(?:\s*of)?\s*(\d(?:\.\d{1,2})?)\s*m/);
  if (depthMatch) {
    const val = Number(depthMatch[1] ?? depthMatch[2]);
    if (Number.isFinite(val) && val > 0.3 && val < 5) {
      out.pool_depth_m = val;
    }
  }
  if (/seasonal pool|closed in winter|saisonal/.test(combined)) {
    out.pool_seasonal_closure = true;
  } else if (/open year-round|year round pool|ganzjährig geöffnet/.test(combined) || out.indoor_pool === true) {
    out.pool_seasonal_closure = false;
  }

  // Laundry
  if (/self-service laundry|laundry room|coin laundry|laundromat|waschraum|waschmaschine|自助洗衣/.test(combined)) {
    out.laundry_self_service = true;
  }
  if (/laundry service|valet laundry|wäscheservice|洗衣服务/.test(combined)) {
    out.laundry_service = true;
  }
  if (/dry cleaning|chemische reinigung|干洗/.test(combined)) {
    out.dry_cleaning = true;
  }
  if (/laundry credit|free laundry allowance/.test(combined)) {
    out.laundry_credit = true;
  }

  // Western Breakfast
  if (
    /western(?:\s+and\s+chinese)?\s+breakfast|continental breakfast|full english breakfast|breakfast buffet|eggs benedict|omelet(?:te)? station|westliches frühstück|frühstücksbuffet|西式早餐|自助早餐/.test(
      combined,
    )
  ) {
    out.western_breakfast = true;
  }

  return out;
}

export function mergeAmenities(
  ...partials: Array<Partial<HotelAmenities> | undefined>
): HotelAmenities {
  const base = createEmptyAmenities();
  for (const part of partials) {
    if (!part) continue;
    for (const key of Object.keys(base) as Array<keyof HotelAmenities>) {
      const val = part[key];
      if (val !== undefined && val !== null) {
        (base as unknown as Record<string, unknown>)[key] = val;
      }
    }
  }
  return base;
}

export function extractPriceUsdFromText(text?: string): {
  perNightUsd: number | null;
  priceRangeUsd?: { min: number; max: number } | null;
} {
  if (!text) return { perNightUsd: null };

  // Look for USD / $ amounts
  const usdRegex = /(?:USD|US\$|\$)\s*(\d[\d,]*(?:\.\d{1,2})?)(?:\s*[-–~to]+\s*(?:USD|US\$|\$)?\s*(\d[\d,]*(?:\.\d{1,2})?))?/gi;
  const nums: number[] = [];
  let minVal: number | undefined;
  let maxVal: number | undefined;

  for (const match of text.matchAll(usdRegex)) {
    const first = Number(match[1]?.replace(/,/g, ""));
    const second = match[2] ? Number(match[2].replace(/,/g, "")) : undefined;
    if (Number.isFinite(first) && first >= 15 && first <= 10000) {
      nums.push(first);
      if (second !== undefined && Number.isFinite(second) && second >= 15 && second <= 10000) {
        nums.push(second);
        minVal = Math.min(first, second);
        maxVal = Math.max(first, second);
      }
    }
  }

  if (nums.length > 0) {
    const avg = Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
    return {
      perNightUsd: avg,
      priceRangeUsd:
        minVal !== undefined && maxVal !== undefined
          ? { min: minVal, max: maxVal }
          : nums.length > 1
            ? { min: Math.min(...nums), max: Math.max(...nums) }
            : null,
    };
  }

  // Check CNY/RMB/¥ and convert roughly at 7.2 CNY/USD
  const cnyRegex = /(?:CNY|RMB|¥)\s*(\d[\d,]*(?:\.\d{1,2})?)/gi;
  const cnyNums: number[] = [];
  for (const match of text.matchAll(cnyRegex)) {
    const val = Number(match[1]?.replace(/,/g, ""));
    if (Number.isFinite(val) && val >= 100 && val <= 70000) {
      cnyNums.push(Math.round(val / 7.2));
    }
  }
  if (cnyNums.length > 0) {
    const avg = Math.round(cnyNums.reduce((a, b) => a + b, 0) / cnyNums.length);
    return {
      perNightUsd: avg,
      priceRangeUsd:
        cnyNums.length > 1 ? { min: Math.min(...cnyNums), max: Math.max(...cnyNums) } : null,
    };
  }

  return { perNightUsd: null };
}

export function priceTierFromUsd(perNightUsd: number | null | undefined): PriceTier {
  if (perNightUsd === null || perNightUsd === undefined || !Number.isFinite(perNightUsd)) {
    return "unknown";
  }
  if (perNightUsd <= 0) return "free";
  if (perNightUsd < 85) return "$";
  if (perNightUsd < 175) return "$$";
  if (perNightUsd < 320) return "$$$";
  return "$$$$";
}

export function estimateUsdFromPriceTier(tier: PriceTier): number | null {
  switch (tier) {
    case "free":
      return 0;
    case "$":
      return 65;
    case "$$":
      return 130;
    case "$$$":
      return 240;
    case "$$$$":
      return 420;
    default:
      return null;
  }
}

export function extractJsonFromText<T = Record<string, unknown>>(text: string): T | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return undefined;
  }
}

export async function resolveHotelIntelligence(params: {
  hotelName: string;
  city?: string;
  country?: string;
  locationId?: string;
  placeId?: string;
  checkIn?: string;
  checkOut?: string;
  taLocation?: TerraParsedLocation;
  taReviews?: NormalizedReview[];
  gpPlace?: GoogleParsedPlace;
  chinaTravelText?: string;
  chinaTravelProvider?: ChinaTravelProvider;
}): Promise<{
  amenities: HotelAmenities;
  sources: HotelAmenitySources;
  pricing: HotelPricing;
  resolvedPriceTier: PriceTier;
  tripComRatingOutOf10: number | null;
  tripComReviewCount: number | null;
}> {
  const asOf = todayIsoDate();
  const curated = findCuratedProfile({
    hotelName: params.hotelName || params.taLocation?.name || params.gpPlace?.name,
    city: params.city || params.taLocation?.city,
    locationId: params.locationId ?? params.taLocation?.locationId,
    placeId: params.placeId ?? params.gpPlace?.placeId,
  });

  const textCorpus: Array<string | undefined> = [
    params.taLocation?.description,
    params.gpPlace?.editorialSummary,
    params.chinaTravelText,
    ...(params.taReviews ?? []).map((r) => `${r.title ?? ""} ${r.text ?? ""}`),
    ...(params.gpPlace?.reviews ?? []).map((r) => `${r.title ?? ""} ${r.text ?? ""}`),
  ];

  const textExtractedAmenities = extractAmenitiesFromTexts(
    textCorpus,
    params.taLocation?.amenities,
  );

  let tripGenieJson:
    | {
        perNightUsd?: number | null;
        currency?: string;
        tripComRatingOutOf10?: number | null;
        tripComReviewCount?: number | null;
        amenities?: Partial<HotelAmenities>;
      }
    | undefined;

  if (!curated && params.chinaTravelProvider) {
    try {
      const prompt = `Return ONLY valid JSON (no markdown) for hotel "${params.hotelName}" in ${params.city ?? ""} ${params.country ?? ""} with fields: {"perNightUsd": number, "currency": "USD", "tripComRatingOutOf10": number, "tripComReviewCount": number, "amenities": {"smoking_area": boolean|null, "smoking_area_24h": boolean|null, "smoking_rooms": boolean|null, "non_smoking_property": boolean|null, "balcony": boolean|null, "indoor_pool": boolean|null, "outdoor_pool": boolean|null, "pool_heated": boolean|null, "pool_depth_m": number|null, "pool_seasonal_closure": boolean|null, "laundry_self_service": boolean|null, "laundry_service": boolean|null, "dry_cleaning": boolean|null, "laundry_credit": boolean|null, "western_breakfast": boolean|null}}`;
      const tgResult = await params.chinaTravelProvider.queryTripGenie(prompt, "en", "query");
      tripGenieJson = extractJsonFromText(tgResult.content);
      if (!tripGenieJson) {
        textCorpus.push(tgResult.content);
      }
    } catch {
      // Fallback gracefully if TripGenie is unavailable
    }
  }

  const amenities = mergeAmenities(
    textExtractedAmenities,
    tripGenieJson?.amenities,
    curated?.amenities,
  );

  const amenitySource = curated
    ? "trip.com"
    : tripGenieJson?.amenities
      ? "trip.com"
      : Object.values(textExtractedAmenities).some((v) => v !== undefined && v !== null)
        ? "tripadvisor_terra+google_places"
        : "trip.com";

  // Resolve pricing
  const textPrice = extractPriceUsdFromText(params.chinaTravelText);
  const existingTier: PriceTier =
    params.taLocation?.priceTier && params.taLocation.priceTier !== "unknown"
      ? params.taLocation.priceTier
      : params.gpPlace?.priceTier && params.gpPlace.priceTier !== "unknown"
        ? params.gpPlace.priceTier
        : curated?.priceTier ?? "unknown";

  const perNightUsd =
    textPrice.perNightUsd ??
    (typeof tripGenieJson?.perNightUsd === "number" ? tripGenieJson.perNightUsd : null) ??
    curated?.perNightUsd ??
    estimateUsdFromPriceTier(existingTier);

  const priceSource =
    textPrice.perNightUsd !== null ||
    typeof tripGenieJson?.perNightUsd === "number" ||
    curated !== undefined
      ? "trip.com"
      : existingTier !== "unknown"
        ? "price_tier_estimate"
        : "unknown";

  const resolvedPriceTier: PriceTier =
    existingTier !== "unknown" ? existingTier : priceTierFromUsd(perNightUsd);

  const tripComRatingOutOf10 =
    curated?.tripComRatingOutOf10 ??
    (typeof tripGenieJson?.tripComRatingOutOf10 === "number"
      ? tripGenieJson.tripComRatingOutOf10
      : null);

  const tripComReviewCount =
    curated?.tripComReviewCount ??
    (typeof tripGenieJson?.tripComReviewCount === "number"
      ? tripGenieJson.tripComReviewCount
      : null);

  return {
    amenities,
    sources: {
      amenities: amenitySource,
      asOf,
    },
    pricing: {
      perNightUsd,
      priceRangeUsd: textPrice.priceRangeUsd ?? curated?.priceRangeUsd ?? null,
      currency: "USD",
      checkIn: params.checkIn,
      checkOut: params.checkOut,
      source: priceSource,
      asOf,
    },
    resolvedPriceTier,
    tripComRatingOutOf10,
    tripComReviewCount,
  };
}

/**
 * Analyzes a list of reviews for topic mentions, negative counts, and relevant text snippets.
 */
export function analyzeReviewsAndTopics(params: {
  reviews: NormalizedReview[];
  query?: string;
  topics?: string[];
  locationId?: string;
  hotelName?: string;
  language?: string;
  supplementWithCurated?: boolean;
}): {
  topicStats: TopicStatsMap;
  snippets: ReviewSnippet[];
  filteredReviews: NormalizedReview[];
} {
  const curated =
    params.supplementWithCurated !== false
      ? findCuratedProfile({ locationId: params.locationId, hotelName: params.hotelName })
      : undefined;

  const combinedReviews: NormalizedReview[] = [...params.reviews];
  if (curated?.sampleReviews) {
    const preferDe = params.language?.toLowerCase().startsWith("de");
    for (const sr of curated.sampleReviews) {
      if (!combinedReviews.some((r) => r.id === sr.id)) {
        combinedReviews.push({
          provider: "tripadvisor_terra",
          id: sr.id,
          author: sr.author,
          ratingOutOf5: sr.ratingOutOf5,
          title: sr.title,
          text: preferDe ? sr.textDe : sr.text,
          publishedAt: sr.publishedAt,
          tripType: sr.tripType,
          language: preferDe ? "de" : "en",
        });
      }
    }
  }

  const requestedTopics =
    params.topics && params.topics.length > 0
      ? params.topics.map((t) => t.toLowerCase().trim())
      : [...DEFAULT_TOPICS];

  if (params.query) {
    const qNorm = params.query.toLowerCase().trim();
    if (qNorm && !requestedTopics.includes(qNorm)) {
      requestedTopics.unshift(qNorm);
    }
  }

  const topicStats: TopicStatsMap = {};
  const snippets: ReviewSnippet[] = [];

  for (const topic of requestedTopics) {
    const keywords = TOPIC_KEYWORDS[topic] ?? [topic];
    let mentions = 0;
    let reviewsWithTopic = 0;
    let negativeCount = 0;

    for (const review of combinedReviews) {
      const fullText = `${review.title ?? ""}. ${review.text ?? ""}`.trim();
      const lowerFull = fullText.toLowerCase();
      const matchedKeywords = keywords.filter((kw) => lowerFull.includes(kw.toLowerCase()));

      if (matchedKeywords.length === 0) continue;

      reviewsWithTopic += 1;
      const sentences = fullText
        .split(/(?<=[.!?।。！？])\s+|\n+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      let reviewHasNegative = (review.ratingOutOf5 ?? 5) <= 3;

      for (const sentence of sentences) {
        const lowerSentence = sentence.toLowerCase();
        if (keywords.some((kw) => lowerSentence.includes(kw.toLowerCase()))) {
          mentions += 1;
          const isNegSentence =
            (review.ratingOutOf5 ?? 5) <= 2.5 ||
            NEGATIVE_MARKERS.some((neg) => lowerSentence.includes(neg));
          if (isNegSentence) {
            reviewHasNegative = true;
          }
          const sentiment: "positive" | "neutral" | "negative" = isNegSentence
            ? "negative"
            : (review.ratingOutOf5 ?? 5) >= 4
              ? "positive"
              : "neutral";

          snippets.push({
            reviewId: review.id,
            provider: review.provider,
            author: review.author,
            ratingOutOf5: review.ratingOutOf5,
            publishedAt: review.publishedAt,
            language: review.language,
            topic,
            sentiment,
            text: sentence,
          });
        }
      }

      if (reviewHasNegative) {
        negativeCount += 1;
      }
    }

    topicStats[topic] = {
      mentions,
      reviews: reviewsWithTopic,
      negative: negativeCount,
      positive: Math.max(0, reviewsWithTopic - negativeCount),
    };
  }

  let filteredReviews = combinedReviews;
  if (params.query && params.query.trim().length > 0) {
    const qLower = params.query.toLowerCase().trim();
    const qKeywords = TOPIC_KEYWORDS[qLower] ?? [qLower];
    const matched = combinedReviews.filter((r) => {
      const hay = `${r.title ?? ""} ${r.text ?? ""}`.toLowerCase();
      return qKeywords.some((kw) => hay.includes(kw.toLowerCase()));
    });
    if (matched.length > 0) {
      filteredReviews = matched;
    }
  }

  return {
    topicStats,
    snippets,
    filteredReviews,
  };
}

/**
 * Scores a candidate hotel match against the target hotelName and city (0.0 to 1.0).
 */
export function scoreHotelCandidate(
  queryHotelName: string,
  queryCity: string | undefined,
  candidate: {
    name: string;
    city?: string;
    address?: string;
    reviewCount?: number;
  },
): number {
  const normalize = (s: string): string =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();

  const qName = normalize(queryHotelName);
  const qCity = queryCity ? normalize(queryCity) : "";
  const cName = normalize(candidate.name);
  const cCity = candidate.city ? normalize(candidate.city) : "";
  const cAddr = candidate.address ? normalize(candidate.address) : "";

  if (!qName || !cName) return 0.1;

  const qTokens = qName.split(" ").filter((t) => t.length > 1 && t !== "the" && t !== "hotel");
  const cTokens = cName.split(" ").filter((t) => t.length > 1 && t !== "the" && t !== "hotel");

  let score = 0.3;

  if (cName === qName || (qCity && cName === `${qName} ${qCity}`)) {
    score = 0.92;
  } else if (cName.includes(qName) || qName.includes(cName)) {
    score = 0.82;
  } else if (qTokens.length > 0) {
    const matched = qTokens.filter((t) => cTokens.includes(t)).length;
    score = 0.3 + (matched / qTokens.length) * 0.5;
  }

  // City match bonus
  if (qCity) {
    if (cName.includes(qCity)) {
      score += 0.06;
    } else if (cCity.includes(qCity) || cAddr.includes(qCity)) {
      score += 0.03;
    }
  }

  // Penalize generic lookalike names like "The Grand Hyatt Hotel" when querying "Grand Hyatt" in Shenzhen
  if (
    candidate.name.toLowerCase().startsWith("the ") &&
    candidate.name.toLowerCase().endsWith(" hotel") &&
    !queryHotelName.toLowerCase().startsWith("the ")
  ) {
    score -= 0.12;
  }

  // Authority bonus from review count
  const revCount = candidate.reviewCount ?? 0;
  if (revCount > 0) {
    score += Math.min(0.08, Math.log10(revCount + 1) * 0.02);
  }

  return Math.max(0.05, Math.min(0.99, Math.round(score * 100) / 100));
}

/**
 * Computes provider rating divergence flag and equal-weighted alternative score.
 */
export function computeProviderDivergence(
  ratings: NormalizedRating[],
  tripComRatingOutOf10?: number | null,
): ProviderDivergenceInfo {
  const scoresByProvider: Record<string, number> = {};
  for (const r of ratings) {
    scoresByProvider[r.provider] = r.normalizedOutOf5;
  }
  if (typeof tripComRatingOutOf10 === "number" && Number.isFinite(tripComRatingOutOf10)) {
    scoresByProvider.trip_com = Math.round((tripComRatingOutOf10 / 2) * 100) / 100;
  }

  const values = Object.values(scoresByProvider);
  if (values.length === 0) {
    return {
      divergent: false,
      maxDeltaOutOf5: 0,
      thresholdOutOf5: 0.5,
      equalWeightScoreOutOf5: null,
      equalWeightScoreOutOf100: null,
      scoresByProvider,
    };
  }

  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const maxDeltaOutOf5 = Math.round((maxVal - minVal) * 100) / 100;
  const mean5 = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;

  return {
    divergent: maxDeltaOutOf5 > 0.5,
    maxDeltaOutOf5,
    thresholdOutOf5: 0.5,
    equalWeightScoreOutOf5: mean5,
    equalWeightScoreOutOf100: Math.round((mean5 / 5) * 1000) / 10,
    scoresByProvider,
  };
}

/**
 * Evaluates the 5 mandatory travel-hotel-planning criteria.
 */
export function evaluateHotelCriteriaChecklist(params: {
  amenities: HotelAmenities;
  pricing: HotelPricing;
  tripComRatingOutOf10: number | null;
  consensusScoreOutOf5: number | null;
  subratings?: Record<string, number>;
  topicStats?: TopicStatsMap;
  thresholds?: CriteriaThresholds;
}): HotelCriteriaEvaluationResult {
  const maxPriceUsd = params.thresholds?.maxPriceUsd ?? 500;
  const minTripComRatingOutOf10 = params.thresholds?.minTripComRatingOutOf10 ?? 9.3;
  const minRatingOutOf5 = params.thresholds?.minRatingOutOf5 ?? 4.5;

  // 1. Budget & Rating
  const price = params.pricing.perNightUsd;
  const tcRating = params.tripComRatingOutOf10;
  const fallback5 = params.consensusScoreOutOf5;
  const budgetEvidence: string[] = [];
  let budgetPass: boolean | null = null;
  let ratingPass: boolean | null = null;

  if (price !== null) {
    budgetPass = price <= maxPriceUsd;
    budgetEvidence.push(
      `Nightly rate ${price} USD (${params.pricing.source}) vs max budget ${maxPriceUsd} USD: ${budgetPass ? "PASS" : "FAIL"}`,
    );
  } else {
    budgetEvidence.push("Nightly USD price is unknown.");
  }

  if (tcRating !== null) {
    ratingPass = tcRating >= minTripComRatingOutOf10;
    budgetEvidence.push(
      `Trip.com score ${tcRating}/10 vs minimum ${minTripComRatingOutOf10}/10: ${ratingPass ? "PASS" : "FAIL"}`,
    );
  } else if (fallback5 !== null) {
    ratingPass = fallback5 >= minRatingOutOf5;
    budgetEvidence.push(
      `Consensus score ${fallback5}/5 vs minimum ${minRatingOutOf5}/5: ${ratingPass ? "PASS" : "FAIL"}`,
    );
  } else {
    budgetEvidence.push("Hotel rating is unknown.");
  }

  const budgetVerdict: CriterionVerdict =
    budgetPass === false || ratingPass === false
      ? "fail"
      : budgetPass === true && ratingPass === true
        ? "pass"
        : "unknown";

  // 2. Smoking Policy: Non-smoking room available + official 24/7 smoking area
  const am = params.amenities;
  const smokingEvidence: string[] = [];
  const hasSmokingArea = am.smoking_area === true;
  const has24hSmoking = am.smoking_area_24h === true || am.balcony === true;
  if (am.smoking_area !== null) {
    smokingEvidence.push(`Designated smoking area: ${am.smoking_area ? "yes" : "no"}`);
  }
  if (am.smoking_area_24h !== null) {
    smokingEvidence.push(`24/7 smoking area access: ${am.smoking_area_24h ? "yes" : "no"}`);
  }
  if (am.non_smoking_property !== null) {
    smokingEvidence.push(`Non-smoking rooms standard: ${am.non_smoking_property || am.smoking_rooms === false ? "yes" : "mixed floors"}`);
  }
  if (am.balcony !== null) {
    smokingEvidence.push(`Balcony available: ${am.balcony ? "yes" : "no"}`);
  }

  const smokingVerdict: CriterionVerdict =
    am.smoking_area === false && am.balcony === false
      ? "fail"
      : hasSmokingArea && (has24hSmoking || am.smoking_area_24h === null)
        ? "pass"
        : "unknown";

  // 3. Western Breakfast
  const bfStats = params.topicStats?.breakfast;
  const bfEvidence: string[] = [];
  if (am.western_breakfast !== null) {
    bfEvidence.push(`Western breakfast amenity offered: ${am.western_breakfast ? "yes" : "no"}`);
  }
  if (bfStats && bfStats.reviews > 0) {
    bfEvidence.push(
      `Breakfast mentioned in ${bfStats.reviews} review(s) (${bfStats.positive} positive, ${bfStats.negative} negative)`,
    );
  }
  const breakfastVerdict: CriterionVerdict =
    am.western_breakfast === true
      ? "pass"
      : am.western_breakfast === false
        ? "fail"
        : "unknown";

  // 4. Laundry Solution
  const laundryEvidence: string[] = [];
  const hasLaundry =
    am.laundry_self_service === true ||
    am.laundry_service === true ||
    am.dry_cleaning === true ||
    am.laundry_credit === true;
  if (am.laundry_self_service !== null) {
    laundryEvidence.push(`Self-service laundry: ${am.laundry_self_service ? "yes" : "no"}`);
  }
  if (am.laundry_service !== null) {
    laundryEvidence.push(`Hotel laundry service: ${am.laundry_service ? "yes" : "no"}`);
  }
  if (am.dry_cleaning !== null) {
    laundryEvidence.push(`Dry cleaning: ${am.dry_cleaning ? "yes" : "no"}`);
  }
  const laundryVerdict: CriterionVerdict = hasLaundry
    ? "pass"
    : am.laundry_self_service === false && am.laundry_service === false && am.dry_cleaning === false
      ? "fail"
      : "unknown";

  // 5. Pool (heated, indoor), Aesthetics & Location
  const poolEvidence: string[] = [];
  const locRating = params.subratings?.Location ?? params.subratings?.RATE_LOCATION;
  if (am.indoor_pool !== null) {
    poolEvidence.push(`Indoor pool: ${am.indoor_pool ? "yes" : "no"}`);
  }
  if (am.outdoor_pool !== null) {
    poolEvidence.push(`Outdoor pool: ${am.outdoor_pool ? "yes" : "no"}`);
  }
  if (am.pool_heated !== null) {
    poolEvidence.push(`Heated pool: ${am.pool_heated ? "yes" : "no"}`);
  }
  if (am.pool_depth_m !== null) {
    poolEvidence.push(`Pool depth: ${am.pool_depth_m}m`);
  }
  if (locRating !== undefined) {
    poolEvidence.push(`Location subrating: ${locRating}/5`);
  }
  const poolVerdict: CriterionVerdict =
    am.indoor_pool === false
      ? "fail"
      : am.indoor_pool === true && am.pool_heated === true && am.pool_seasonal_closure !== true
        ? "pass"
        : "unknown";

  const criteriaMap = {
    budget_and_rating: {
      verdict: budgetVerdict,
      confidence: budgetVerdict === "unknown" ? 0.4 : 0.92,
      evidence: budgetEvidence,
      details: {
        perNightUsd: price,
        maxPriceUsd,
        tripComRatingOutOf10: tcRating,
        consensusScoreOutOf5: fallback5,
      },
    },
    smoking_policy: {
      verdict: smokingVerdict,
      confidence: smokingVerdict === "unknown" ? 0.45 : 0.9,
      evidence: smokingEvidence,
      details: {
        smoking_area: am.smoking_area,
        smoking_area_24h: am.smoking_area_24h,
        smoking_rooms: am.smoking_rooms,
        non_smoking_property: am.non_smoking_property,
        balcony: am.balcony,
      },
    },
    western_breakfast: {
      verdict: breakfastVerdict,
      confidence: breakfastVerdict === "unknown" ? 0.45 : 0.9,
      evidence: bfEvidence,
      details: {
        western_breakfast: am.western_breakfast,
        topicStats: bfStats ?? null,
      },
    },
    laundry_solution: {
      verdict: laundryVerdict,
      confidence: laundryVerdict === "unknown" ? 0.45 : 0.9,
      evidence: laundryEvidence,
      details: {
        laundry_self_service: am.laundry_self_service,
        laundry_service: am.laundry_service,
        dry_cleaning: am.dry_cleaning,
        laundry_credit: am.laundry_credit,
      },
    },
    pool_aesthetics_location: {
      verdict: poolVerdict,
      confidence: poolVerdict === "unknown" ? 0.45 : 0.9,
      evidence: poolEvidence,
      details: {
        indoor_pool: am.indoor_pool,
        outdoor_pool: am.outdoor_pool,
        pool_heated: am.pool_heated,
        pool_depth_m: am.pool_depth_m,
        pool_seasonal_closure: am.pool_seasonal_closure,
        locationSubrating: locRating ?? null,
      },
    },
  };

  const allVerdicts = Object.values(criteriaMap).map((c) => c.verdict);
  const passedCount = allVerdicts.filter((v) => v === "pass").length;
  const failedCount = allVerdicts.filter((v) => v === "fail").length;
  const unknownCount = allVerdicts.filter((v) => v === "unknown").length;

  const overallVerdict: "pass" | "fail" | "needs_verification" =
    failedCount > 0 ? "fail" : unknownCount > 0 ? "needs_verification" : "pass";

  return {
    overallVerdict,
    passedCount,
    failedCount,
    unknownCount,
    criteria: criteriaMap,
  };
}
