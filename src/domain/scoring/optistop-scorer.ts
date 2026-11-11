import {
  BooleanAmenityKey,
  EvaluatedOptimalStop,
  RoadStopEntity,
  StopAmenities,
  StopSearchFilters,
} from '../models/types';
import { addMinutesAsClock, DEFAULT_TIME_ZONE } from '../time/clock';
import { buildNavigationLinks } from '../navigation/deep-links';
import {
  computeBayesianRating,
  computeQualitySubScore,
  computeValueAndWindowSubScore,
} from './bayesian-quality';
import { computeDetourSubScore } from './detour-calculator';

export const OPTISTOP_WEIGHTS = {
  DETOUR: 0.40,
  QUALITY: 0.35,
  VALUE: 0.15,
  AMENITIES: 0.10,
} as const;

/**
 * RNF-04.3: Solo suma puntos cuando el servicio es explícitamente `true`.
 * Un servicio `null` (desconocido) aporta 0 puntos adicionales.
 */
export function computeAmenitiesSubScore(
  amenities: StopAmenities,
  requestedAmenities?: Partial<Record<BooleanAmenityKey, boolean>>
): number {
  let score = 35;

  if (amenities.hasEasyParking === true) score += 15;
  if (amenities.hasCleanRestrooms === true) score += 15;
  if (amenities.hasGasStationOnsite === true) score += 12;
  if (amenities.hasEvChargerNearby === true) score += 12;
  if (amenities.isPetFriendly === true) score += 6;
  if (amenities.hasKidsArea === true) score += 5;

  if (requestedAmenities) {
    for (const [key, required] of Object.entries(requestedAmenities)) {
      if (required && amenities[key as BooleanAmenityKey] === true) {
        score += 12;
      }
    }
  }

  return Math.min(100, score);
}

/**
 * RNF-04.3: Si el usuario exige un filtro estricto (p. ej. `maxPriceLevel: 1` o `hasEvChargerNearby: true`),
 * un valor `null` (desconocido) NO satisface el filtro.
 */
export function matchesSearchFilters(
  stop: RoadStopEntity,
  detourMinutes: number,
  filters?: StopSearchFilters
): boolean {
  if (!filters) return true;

  if (filters.categories && filters.categories.length > 0) {
    if (!filters.categories.includes(stop.category)) return false;
  }

  if (filters.maxPriceLevel) {
    if (stop.priceLevel === null) {
      // Si pide un tope estricto (< 3), descartamos precios desconocidos
      if (filters.maxPriceLevel < 3) return false;
    } else if (stop.priceLevel > filters.maxPriceLevel) {
      return false;
    }
  }

  if (
    typeof filters.maxDetourMinutes === 'number' &&
    detourMinutes > filters.maxDetourMinutes
  ) {
    return false;
  }

  if (filters.requiredAmenities) {
    for (const [key, isRequired] of Object.entries(filters.requiredAmenities)) {
      if (isRequired && stop.amenities[key as BooleanAmenityKey] !== true) {
        return false;
      }
    }
  }

  return true;
}

export function buildMatchReasons(
  stop: RoadStopEntity,
  detourMinutes: number,
  bayesianRating: number
): string[] {
  const reasons: string[] = [];

  if (detourMinutes <= 2 && stop.accessType === 'DIRECT_SERVICE_AREA') {
    reasons.push(`Acceso directo en vía (+${detourMinutes} min ida y vuelta)`);
  } else if (detourMinutes <= 4) {
    reasons.push(`Desvío mínimo (+${detourMinutes} min ida y vuelta)`);
  } else {
    reasons.push(`Desvío total de +${detourMinutes} min`);
  }

  if (stop.ratingAvg !== null && bayesianRating >= 4.35 && stop.reviewCount >= 200) {
    reasons.push(
      `Alta fiabilidad (${bayesianRating}★ ponderada en ${stop.reviewCount.toLocaleString('es-ES')} reseñas)`
    );
  } else if (stop.ratingAvg !== null && bayesianRating >= 4.0) {
    reasons.push(`Valoración ponderada (${bayesianRating}★)`);
  } else if (stop.ratingAvg === null) {
    reasons.push('POI detectado en OpenStreetMap (sin reseñas aún)');
  }

  if (stop.priceLevel === 1 && bayesianRating >= 4.0) {
    reasons.push('Excelente relación calidad/precio (€)');
  } else if (stop.priceLevel === 2 && bayesianRating >= 4.2) {
    reasons.push('Buena relación calidad/precio (€€)');
  }

  if (stop.amenities.hasEvChargerNearby === true) {
    reasons.push(
      stop.amenities.evChargerDetails
        ? `Cargador EV (${stop.amenities.evChargerDetails})`
        : 'Cargador EV cercano (<300m)'
    );
  }

  if (stop.amenities.hasGasStationOnsite === true) {
    reasons.push(
      stop.amenities.gasStationBrand
        ? `Gasolinera ${stop.amenities.gasStationBrand} en la misma área`
        : 'Gasolinera en la misma área de servicio'
    );
  }

  return reasons.slice(0, 4);
}

export function evaluateCandidateStop(params: {
  stop: RoadStopEntity;
  distanceFromOriginKm: number;
  etaMinutesFromStart: number;
  departureTimeIso: string;
  timeZone?: string;
  detourTimeMinutes: number;
  detourDistanceKm: number;
  perpendicularDistanceKm: number;
  windowMinMinutes: number;
  windowMaxMinutes: number;
  destinationCoord?: { lat: number; lon: number };
  filters?: StopSearchFilters;
}): EvaluatedOptimalStop {
  const {
    stop,
    distanceFromOriginKm,
    etaMinutesFromStart,
    departureTimeIso,
    timeZone = DEFAULT_TIME_ZONE,
    detourTimeMinutes,
    detourDistanceKm,
    perpendicularDistanceKm,
    windowMinMinutes,
    windowMaxMinutes,
    destinationCoord,
    filters,
  } = params;

  const bayesianRating = computeBayesianRating(stop.ratingAvg, stop.reviewCount);
  const detourScore = computeDetourSubScore(detourTimeMinutes);
  const qualityScore = computeQualitySubScore(bayesianRating);
  const valueScore = computeValueAndWindowSubScore(
    bayesianRating,
    stop.priceLevel,
    etaMinutesFromStart,
    windowMinMinutes,
    windowMaxMinutes
  );
  const amenitiesScore = computeAmenitiesSubScore(
    stop.amenities,
    filters?.requiredAmenities
  );

  const rawComposite =
    OPTISTOP_WEIGHTS.DETOUR * detourScore +
    OPTISTOP_WEIGHTS.QUALITY * qualityScore +
    OPTISTOP_WEIGHTS.VALUE * valueScore +
    OPTISTOP_WEIGHTS.AMENITIES * amenitiesScore;

  const optiStopScore = Number(Math.max(0, Math.min(100, rawComposite)).toFixed(1));

  return {
    ...stop,
    routeMetrics: {
      distanceFromOriginKm,
      etaMinutesFromStart,
      estimatedArrivalClock: addMinutesAsClock(
        departureTimeIso,
        etaMinutesFromStart,
        timeZone
      ),
      detourTimeMinutes,
      detourDistanceKm,
      perpendicularDistanceKm,
    },
    scoring: {
      optiStopScore,
      bayesianRating,
      detourScore,
      qualityScore,
      valueScore,
      amenitiesScore,
      matchReasons: buildMatchReasons(stop, detourTimeMinutes, bayesianRating),
    },
    navigationLinks: buildNavigationLinks(
      stop.coordinates,
      stop.name,
      destinationCoord,
      stop.googlePlaceId,
      stop.googleMapsPlaceUrl
    ),
  };
}
