import {
  CorridorBoundingBox,
  ExternalDiscoveryResult,
  IExternalStopProviderPort,
  IStopCacheRepositoryPort,
} from '@/domain/models/ports';
import { PriceLevel, RoadStopEntity } from '@/domain/models/types';

export interface GooglePlacesAdapterOptions {
  apiKey?: string;
  maxFreeCallsPerMonth?: number;
  quotaStore?: IStopCacheRepositoryPort;
}

/**
 * Adaptador para Google Places API (New) con Quota Guard persistente por mes natural (RNF-07.2).
 * - Corrige el FieldMask a camelCase (`places.formattedAddress`).
 * - Declara las llamadas y el coste estimado real en `ExternalDiscoveryResult`.
 */
export class GooglePlacesQuotaGuardedAdapter
  implements IExternalStopProviderPort
{
  public readonly providerName = 'GOOGLE_PLACES_QUOTA_GUARDED' as const;
  private readonly apiKey?: string;
  private readonly maxFreeCallsPerMonth: number;
  private readonly quotaStore?: IStopCacheRepositoryPort;

  constructor(options?: GooglePlacesAdapterOptions) {
    this.apiKey = options?.apiKey ?? process.env.GOOGLE_PLACES_API_KEY;
    const envLimit = process.env.GOOGLE_PLACES_MAX_MONTHLY_FREE_CALLS;
    this.maxFreeCallsPerMonth =
      options?.maxFreeCallsPerMonth ??
      (envLimit ? Math.max(1, Number(envLimit)) : 150);
    this.quotaStore = options?.quotaStore;
  }

  public hasApiKey(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  public async getRemainingMonthlyQuota(): Promise<number> {
    if (!this.hasApiKey()) return this.maxFreeCallsPerMonth;
    if (!this.quotaStore) return this.maxFreeCallsPerMonth;
    const used = await this.quotaStore.getMonthlyQuotaUsed('gplaces');
    return Math.max(0, this.maxFreeCallsPerMonth - used);
  }

  async discoverStopsInCorridor(
    corridor: CorridorBoundingBox
  ): Promise<ExternalDiscoveryResult> {
    if (!this.hasApiKey() || corridor.polyline.length === 0) {
      return { stops: [], billableCalls: 0, estimatedCostUsd: 0 };
    }

    if (this.quotaStore) {
      const allowed = await this.quotaStore.incrementMonthlyQuotaIfBelow(
        'gplaces',
        this.maxFreeCallsPerMonth
      );
      if (!allowed) {
        return { stops: [], billableCalls: 0, estimatedCostUsd: 0 };
      }
    }

    const midVertex =
      corridor.polyline[Math.floor(corridor.polyline.length / 2)];

    try {
      const response = await fetch(
        'https://places.googleapis.com/v1/places:searchNearby',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': this.apiKey!,
            'X-Goog-FieldMask':
              'places.id,places.displayName,places.location,places.rating,places.userRatingCount,places.priceLevel,places.formattedAddress',
          },
          body: JSON.stringify({
            includedTypes: ['restaurant', 'cafe'],
            maxResultCount: 8,
            locationRestriction: {
              circle: {
                center: {
                  latitude: midVertex.lat,
                  longitude: midVertex.lon,
                },
                radius: Math.min(15000, corridor.maxRadiusKm * 2000),
              },
            },
          }),
        }
      );

      if (!response.ok) {
        return { stops: [], billableCalls: 1, estimatedCostUsd: 0 };
      }
      const data = await response.json();
      const places = data?.places ?? [];

      const stops: RoadStopEntity[] = places.map(
        (p: Record<string, unknown>, idx: number): RoadStopEntity => {
          const loc =
            (p.location as { latitude?: number; longitude?: number }) ?? {};
          const displayName = (p.displayName as { text?: string }) ?? {};
          const priceLevel: PriceLevel | null =
            p.priceLevel === 'PRICE_LEVEL_INEXPENSIVE'
              ? 1
              : p.priceLevel === 'PRICE_LEVEL_MODERATE'
              ? 2
              : p.priceLevel === 'PRICE_LEVEL_EXPENSIVE' ||
                p.priceLevel === 'PRICE_LEVEL_VERY_EXPENSIVE'
              ? 3
              : null;

          const placeIdStr = String(p.id || idx);
          const gMapsUrl = `https://www.google.com/maps/place/?q=place_id:${placeIdStr}`;

          return {
            id: `gplaces-${placeIdStr}`,
            name: displayName.text || 'Restaurante en Ruta',
            category: 'RESTAURANT',
            highwayCode: 'Ruta Principal',
            kmMarker: Math.round(midVertex.cumulativeKm),
            locality: String(p.formattedAddress || 'Corredor Vial'),
            coordinates: {
              lat: Number(loc.latitude ?? midVertex.lat),
              lon: Number(loc.longitude ?? midVertex.lon),
            },
            accessType: 'HIGHWAY_EXIT_EASY',
            directionNotes: 'Acceso desde salida próxima al tramo',
            ratingAvg: typeof p.rating === 'number' ? p.rating : null,
            reviewCount:
              typeof p.userRatingCount === 'number' ? p.userRatingCount : 0,
            priceLevel,
            specialty: 'Establecimiento verificado en Google Places',
            avgStopDurationMin: 35,
            openingHours: 'Consultar horario en Google Maps',
            amenities: {
              hasEvChargerNearby: null,
              hasGasStationOnsite: null,
              hasEasyParking: null,
              hasCleanRestrooms: null,
              isPetFriendly: null,
              hasKidsArea: null,
              hasTruckParking: null,
              hasWifi: null,
            },
            source: 'GOOGLE_CACHED',
            dataQuality: 'VERIFIED',
            googlePlaceId: placeIdStr,
            googleMapsPlaceUrl: gMapsUrl,
          };
        }
      );

      return {
        stops,
        billableCalls: 1,
        estimatedCostUsd: 0, // Cubierto por el límite gratuito mensual del Quota Guard
      };
    } catch {
      return { stops: [], billableCalls: 1, estimatedCostUsd: 0 };
    }
  }
}
