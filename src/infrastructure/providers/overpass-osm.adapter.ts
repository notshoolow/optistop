import {
  CorridorBoundingBox,
  ExternalDiscoveryResult,
  IExternalStopProviderPort,
} from '@/domain/models/ports';
import {
  Coordinates,
  RoadStopEntity,
  StopCategory,
} from '@/domain/models/types';
import {
  haversineDistanceKm,
  projectStopOntoCorridor,
} from '@/domain/geometry/corridor-slicer';

export interface OverpassElement {
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/**
 * RNF-04.2: Transforma elementos de Overpass en `RoadStopEntity` SIN inventar notas, precios ni servicios.
 * Lo que no consta explícitamente en los tags de OpenStreetMap o por cruce espacial se deja en `null`.
 */
export function mapOverpassElementsToStops(
  elements: OverpassElement[],
  corridor: CorridorBoundingBox
): RoadStopEntity[] {
  const fuelNodes: { coord: Coordinates; brand?: string }[] = [];
  const evNodes: { coord: Coordinates; operator?: string }[] = [];
  const foodCandidates: OverpassElement[] = [];

  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;

    const amenity = el.tags?.amenity;
    const highway = el.tags?.highway;

    if (amenity === 'fuel') {
      fuelNodes.push({
        coord: { lat, lon },
        brand: el.tags?.brand || el.tags?.operator,
      });
    } else if (amenity === 'charging_station') {
      evNodes.push({
        coord: { lat, lon },
        operator: el.tags?.operator || el.tags?.brand,
      });
    }

    if (
      (amenity === 'restaurant' ||
        amenity === 'cafe' ||
        highway === 'services') &&
      el.tags?.name
    ) {
      foodCandidates.push(el);
    }
  }

  const discovered: RoadStopEntity[] = [];

  for (const item of foodCandidates.slice(0, 12)) {
    const lat = item.lat ?? item.center?.lat;
    const lon = item.lon ?? item.center?.lon;
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;

    const proj = projectStopOntoCorridor(
      { lat, lon },
      corridor.polyline,
      corridor.maxRadiusKm
    );
    if (!proj.isWithinCorridor) continue;

    const tags = item.tags ?? {};
    const nearbyFuel = fuelNodes.find(
      (f) => haversineDistanceKm({ lat, lon }, f.coord) <= 0.35
    );
    const nearbyEv = evNodes.find(
      (e) => haversineDistanceKm({ lat, lon }, e.coord) <= 0.35
    );

    const category: StopCategory =
      tags.highway === 'services'
        ? 'SERVICE_AREA'
        : tags.amenity === 'cafe'
        ? 'CAFE_BAKERY'
        : 'RESTAURANT';

    discovered.push({
      id: `osm-${item.id}`,
      name: tags.name,
      category,
      highwayCode: tags['addr:street'] || 'Vía Principal',
      kmMarker: proj.distanceFromOriginKm,
      locality:
        tags['addr:city'] ||
        tags['addr:municipality'] ||
        'Tramo en Ruta (OpenStreetMap)',
      coordinates: { lat, lon },
      accessType:
        proj.perpendicularDistanceKm <= 0.35
          ? 'DIRECT_SERVICE_AREA'
          : proj.perpendicularDistanceKm <= 1.5
          ? 'HIGHWAY_EXIT_EASY'
          : 'TOWN_ENTRY',
      directionNotes:
        proj.perpendicularDistanceKm <= 0.35
          ? 'Acceso inmediato junto a la vía'
          : `A ${proj.perpendicularDistanceKm} km de la vía principal`,
      // RNF-04.2: Prohibido inventar notas o precios que OSM no posee
      ratingAvg: null,
      reviewCount: 0,
      priceLevel: null,
      specialty: tags.cuisine
        ? `Cocina (${tags.cuisine.replace(/;/g, ', ')}) registrada en OpenStreetMap`
        : 'Establecimiento registrado en OpenStreetMap (sin reseñas verificadas)',
      avgStopDurationMin: category === 'CAFE_BAKERY' ? 20 : 35,
      openingHours: tags.opening_hours || 'Sin horario verificado',
      amenities: {
        hasEvChargerNearby: nearbyEv ? true : null,
        evChargerDetails: nearbyEv?.operator
          ? `Punto de carga (${nearbyEv.operator}) a <350m`
          : nearbyEv
          ? 'Punto de carga EV a <350m'
          : undefined,
        hasGasStationOnsite:
          nearbyFuel || tags.highway === 'services' ? true : null,
        gasStationBrand: nearbyFuel?.brand,
        hasEasyParking: tags.parking ? true : null,
        hasCleanRestrooms:
          tags.toilets === 'yes' ? true : tags.toilets === 'no' ? false : null,
        isPetFriendly:
          tags.dog === 'yes' || tags.outdoor_seating === 'yes'
            ? true
            : tags.dog === 'no'
            ? false
            : null,
        hasKidsArea: tags.playground === 'yes' ? true : null,
        hasTruckParking:
          tags.hgv === 'yes' || tags.highway === 'services' ? true : null,
        hasWifi:
          tags.internet_access === 'wlan' || tags.wifi === 'yes'
            ? true
            : tags.internet_access === 'no'
            ? false
            : null,
      },
      source: 'OSM_ENRICHED',
      dataQuality: 'UNVERIFIED_OSM',
    });
  }

  return discovered;
}

export class OverpassOsmAdapter implements IExternalStopProviderPort {
  public readonly providerName = 'OVERPASS_OSM' as const;
  private readonly endpoint: string | null;
  private readonly timeoutMs: number;

  constructor(endpoint?: string | null, timeoutMs = 2500) {
    const raw =
      endpoint !== undefined
        ? endpoint
        : process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter';
    this.endpoint =
      raw === null || raw === 'disabled' || raw.trim() === '' ? null : raw;
    this.timeoutMs = timeoutMs;
  }

  async discoverStopsInCorridor(
    corridor: CorridorBoundingBox
  ): Promise<ExternalDiscoveryResult> {
    if (!this.endpoint || corridor.polyline.length === 0) {
      return { stops: [], billableCalls: 0, estimatedCostUsd: 0 };
    }

    const bbox = `${corridor.minLat.toFixed(3)},${corridor.minLon.toFixed(
      3
    )},${corridor.maxLat.toFixed(3)},${corridor.maxLon.toFixed(3)}`;

    const query = `
      [out:json][timeout:3];
      (
        node["amenity"~"restaurant|cafe|fuel|charging_station"](${bbox});
        way["highway"="services"](${bbox});
      );
      out center 60;
    `;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'OptiStopCarreteras/1.1',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        return { stops: [], billableCalls: 0, estimatedCostUsd: 0 };
      }
      const json = await res.json();
      const elements: OverpassElement[] = json?.elements ?? [];
      return {
        stops: mapOverpassElementsToStops(elements, corridor),
        billableCalls: 0,
        estimatedCostUsd: 0,
      };
    } catch {
      return { stops: [], billableCalls: 0, estimatedCostUsd: 0 };
    }
  }
}
