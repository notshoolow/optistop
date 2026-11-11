import {
  AccessType,
  CommunityStopSubmission,
  Coordinates,
  RoadStopEntity,
  RoutePrecision,
  RouteVertex,
  RoutingProviderType,
} from './types';

export interface CorridorBoundingBox {
  corridorHash: string;
  polyline: RouteVertex[];
  maxRadiusKm: number;
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface RouteComputation {
  totalDurationMinutes: number;
  totalDistanceKm: number;
  polyline: RouteVertex[];
  provider: RoutingProviderType;
  precision: RoutePrecision;
}

/**
 * PUERTO 1: Motor de Rutas y Geometría Vial
 */
export interface IRoutingPort {
  computeRoute(
    origin: Coordinates,
    destination: Coordinates
  ): Promise<RouteComputation>;

  estimateRoundTripDetourMinutes(
    corridorPointPre: Coordinates,
    stopCoord: Coordinates,
    corridorPointPost: Coordinates,
    accessType: AccessType,
    perpendicularDistanceKm: number
  ): Promise<{ detourMinutes: number; detourDistanceKm: number }>;
}

/**
 * PUERTO 2: Repositorio Propio Cache-First + Moderación + Cuota Mensual
 */
export interface IStopCacheRepositoryPort {
  findStopsInCorridor(corridor: CorridorBoundingBox): Promise<RoadStopEntity[]>;
  saveOrUpdateStops(stops: RoadStopEntity[], corridorHash: string): Promise<void>;
  hasFreshCorridorCoverage(corridorHash: string): Promise<boolean>;
  submitCommunityStop(submission: CommunityStopSubmission): Promise<RoadStopEntity>;
  listPending(): Promise<RoadStopEntity[]>;
  approvePending(stopId: string): Promise<RoadStopEntity | null>;
  rejectPending(stopId: string): Promise<boolean>;
  getAllActiveStops(): Promise<RoadStopEntity[]>;
  incrementMonthlyQuotaIfBelow(
    providerKey: string,
    maxMonthlyCalls: number,
    now?: Date
  ): Promise<boolean>;
  getMonthlyQuotaUsed(providerKey: string, now?: Date): Promise<number>;
}

export interface ExternalDiscoveryResult {
  stops: RoadStopEntity[];
  billableCalls: number;
  estimatedCostUsd: number;
}

/**
 * PUERTO 3: Proveedores Externos de Descubrimiento (Conmutables por Presupuesto)
 */
export interface IExternalStopProviderPort {
  readonly providerName: 'OVERPASS_OSM' | 'GOOGLE_PLACES_QUOTA_GUARDED';
  discoverStopsInCorridor(
    corridor: CorridorBoundingBox
  ): Promise<ExternalDiscoveryResult>;
}
