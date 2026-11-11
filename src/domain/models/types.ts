export type StopCategory =
  | 'RESTAURANT'        // Restaurante de carretera / asador / venta tradicional
  | 'CAFE_BAKERY'       // Cafetería / obrador / parada rápida desayuno-merienda
  | 'SERVICE_AREA'      // Área de servicio integral (restauración + estación)
  | 'REST_AREA_PICNIC'; // Área de descanso destacada con servicios

export type AccessType =
  | 'DIRECT_SERVICE_AREA'         // Acceso directo en la propia vía
  | 'HIGHWAY_EXIT_EASY'           // Salida inmediata (< 800m en rotonda)
  | 'OPPOSITE_DIRECTION_OVERPASS' // Cambio de sentido por paso elevado
  | 'TOWN_ENTRY';                 // Entrada a población cercana

export type PriceLevel = 1 | 2 | 3; // 1 = €, 2 = €€, 3 = €€€

export type StopSource =
  | 'CURATED_DB'
  | 'OSM_ENRICHED'
  | 'GOOGLE_CACHED'
  | 'COMMUNITY';

/**
 * RNF-04.1: Nivel de verificación e integridad de datos de la parada.
 */
export type DataQualityLevel =
  | 'VERIFIED'
  | 'DEMO_UNVERIFIED'
  | 'UNVERIFIED_OSM'
  | 'COMMUNITY_PENDING';

export type RoutingProviderType =
  | 'OSRM_LIVE'
  | 'CORRIDOR_FIXTURE'
  | 'STRAIGHT_LINE';

export type RoutePrecision = 'HIGH' | 'LOW';

export interface Coordinates {
  lat: number;
  lon: number;
}

export interface RouteVertex extends Coordinates {
  cumulativeMinutes: number;
  cumulativeKm: number;
}

/**
 * RNF-04.2: Los booleanos admiten `null` para representar "desconocido / sin verificar"
 * en lugar de inventar valores por defecto en POIs de OpenStreetMap.
 */
export interface StopAmenities {
  hasEvChargerNearby: boolean | null;
  evChargerDetails?: string;
  hasGasStationOnsite: boolean | null;
  gasStationBrand?: string;
  hasEasyParking: boolean | null;
  hasCleanRestrooms: boolean | null;
  isPetFriendly: boolean | null;
  hasKidsArea: boolean | null;
  hasTruckParking: boolean | null;
  hasWifi: boolean | null;
}

export type BooleanAmenityKey =
  | 'hasEvChargerNearby'
  | 'hasGasStationOnsite'
  | 'hasEasyParking'
  | 'hasCleanRestrooms'
  | 'isPetFriendly'
  | 'hasKidsArea'
  | 'hasTruckParking'
  | 'hasWifi';

export interface RoadStopEntity {
  id: string;
  name: string;
  category: StopCategory;
  highwayCode: string;
  kmMarker: number;
  locality: string;
  coordinates: Coordinates;
  accessType: AccessType;
  directionNotes: string;
  ratingAvg: number | null;
  reviewCount: number;
  priceLevel: PriceLevel | null;
  specialty: string;
  avgStopDurationMin: number;
  openingHours: string;
  amenities: StopAmenities;
  source: StopSource;
  dataQuality: DataQualityLevel;
  googlePlaceId?: string;
  googleMapsPlaceUrl?: string;
  cachedAtIso?: string;
}

export interface CommunityStopSubmission {
  name: string;
  highwayCode: string;
  kmMarker: number;
  locality: string;
  coordinates: Coordinates;
  category: StopCategory;
  accessType: AccessType;
  directionNotes?: string;
  priceLevel?: PriceLevel | null;
  specialty?: string;
  avgStopDurationMin?: number;
  openingHours?: string;
  amenities?: Partial<StopAmenities>;
}

export interface NavigationLinks {
  googleMapsUrl: string;
  wazeUrl: string;
  appleMapsUrl: string;
}

export interface EvaluatedOptimalStop extends RoadStopEntity {
  routeMetrics: {
    distanceFromOriginKm: number;
    etaMinutesFromStart: number;
    estimatedArrivalClock: string;
    detourTimeMinutes: number;
    detourDistanceKm: number;
    perpendicularDistanceKm: number;
  };
  scoring: {
    optiStopScore: number;       // 0 a 100
    bayesianRating: number;      // 1.0 a 5.0 ponderado
    detourScore: number;         // 0 a 100
    qualityScore: number;        // 0 a 100
    valueScore: number;          // 0 a 100
    amenitiesScore: number;      // 0 a 100
    matchReasons: string[];
  };
  navigationLinks: NavigationLinks;
}

export type StopWindowMode = 'TIME_FROM_START' | 'CLOCK_RANGE' | 'DISTANCE_RANGE';

export interface StopWindowInput {
  type: StopWindowMode;
  minMinutesFromStart?: number;
  maxMinutesFromStart?: number;
  clockStartHHMM?: string;
  clockEndHHMM?: string;
  minDistanceKm?: number;
  maxDistanceKm?: number;
}

export interface StopSearchFilters {
  categories?: StopCategory[];
  maxPriceLevel?: PriceLevel;
  maxDetourMinutes?: number;
  requiredAmenities?: Partial<Record<BooleanAmenityKey, boolean>>;
}

export interface OptimalStopsRequest {
  mode: 'PLANNING' | 'EN_ROUTE';
  origin: {
    label: string;
    lat: number;
    lon: number;
  };
  destination: {
    label: string;
    lat: number;
    lon: number;
  };
  departureTimeIso?: string;
  timeZone?: string;
  stopWindow: StopWindowInput;
  filters?: StopSearchFilters;
  limit?: number;
}

export interface TelemetryWarning {
  code: 'DEMO_DATA' | 'UNVERIFIED_OSM_DATA' | 'LOW_PRECISION_ROUTE';
  message: string;
}

export interface OptimalStopsResponse {
  routeSummary: {
    originLabel: string;
    destinationLabel: string;
    totalDurationMinutes: number;
    totalDistanceKm: number;
    fullPolyline: RouteVertex[];
    windowPolyline: RouteVertex[];
    routingProvider: RoutingProviderType;
    precision: RoutePrecision;
  };
  windowInfo: {
    minMinutes: number;
    maxMinutes: number;
    minKm: number;
    maxKm: number;
    windowStartClock: string;
    windowEndClock: string;
    corridorHash: string;
  };
  telemetry: {
    corridorCacheHit: boolean;
    cacheHit: boolean;
    totalCandidatesEvaluated: number;
    sourcesBreakdown: Record<StopSource, number>;
    billableCalls: number;
    estimatedApiCostUsd: number;
    responseTimeMs: number;
    quotaRemainingMonthly: number;
    warnings: TelemetryWarning[];
  };
  optimalStops: EvaluatedOptimalStop[];
}
