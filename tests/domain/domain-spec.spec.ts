import { describe, expect, it } from 'vitest';
import {
  projectPointOnPolyline,
  resolveStopWindowBounds,
  sliceRouteByWindow,
} from '@/domain/geometry/corridor-slicer';
import { addMinutesAsClock, assertValidTimeZone } from '@/domain/time/clock';
import {
  calculateGeometricRoundTripDetour,
  computeDetourSubScore,
} from '@/domain/scoring/detour-calculator';
import {
  BAYESIAN_PRIOR_MEAN_C,
  computeBayesianRating,
  computeQualitySubScore,
} from '@/domain/scoring/bayesian-quality';
import {
  computeAmenitiesSubScore,
  evaluateCandidateStop,
  matchesSearchFilters,
} from '@/domain/scoring/optistop-scorer';
import { RoadStopEntity, RouteVertex } from '@/domain/models/types';

const POLY: RouteVertex[] = [
  { lat: 40.4168, lon: -3.7038, cumulativeMinutes: 0, cumulativeKm: 0 },
  { lat: 40.0, lon: -3.0, cumulativeMinutes: 45, cumulativeKm: 80 },
  { lat: 39.85, lon: -2.65, cumulativeMinutes: 65, cumulativeKm: 110 },
  { lat: 39.6, lon: -2.1, cumulativeMinutes: 105, cumulativeKm: 175 },
  { lat: 39.5, lon: -1.1, cumulativeMinutes: 155, cumulativeKm: 270 },
  { lat: 39.4699, lon: -0.3763, cumulativeMinutes: 200, cumulativeKm: 355 },
];

const BASE_STOP: RoadStopEntity = {
  id: 'a3-pk103-test',
  name: 'Parada de prueba',
  category: 'RESTAURANT',
  highwayCode: 'A-3',
  kmMarker: 103,
  locality: 'Test',
  coordinates: { lat: 39.851, lon: -2.651 },
  accessType: 'HIGHWAY_EXIT_EASY',
  directionNotes: 'Salida 103',
  ratingAvg: 4.5,
  reviewCount: 1200,
  priceLevel: 2,
  specialty: 'Brasa',
  avgStopDurationMin: 35,
  openingHours: '07:00 - 23:30',
  amenities: {
    hasEvChargerNearby: true,
    hasGasStationOnsite: true,
    hasEasyParking: true,
    hasCleanRestrooms: true,
    isPetFriendly: true,
    hasKidsArea: false,
    hasTruckParking: true,
    hasWifi: true,
  },
  source: 'CURATED_DB',
  dataQuality: 'VERIFIED',
};

describe('RNF-06.1 · Reloj independiente de la zona del servidor', () => {
  it('resuelve 14:00–15:00 saliendo 12:30 (Europe/Madrid) como [90, 150] sea cual sea process.env.TZ', () => {
    const b = resolveStopWindowBounds(
      POLY,
      { type: 'CLOCK_RANGE', clockStartHHMM: '14:00', clockEndHHMM: '15:00' },
      '2026-11-10T11:30:00.000Z', // 12:30 en Madrid (CET)
      'Europe/Madrid'
    );
    expect(b.minMinutes).toBe(90);
    expect(b.maxMinutes).toBe(150);
  });

  it('respeta el horario de verano (CEST +02:00) y Canarias', () => {
    // 2026-07-15 10:30Z = 12:30 Madrid (CEST) = 11:30 Canarias (WEST)
    expect(addMinutesAsClock('2026-07-15T10:30:00.000Z', 92, 'Europe/Madrid')).toBe('14:02');
    expect(addMinutesAsClock('2026-07-15T10:30:00.000Z', 92, 'Atlantic/Canary')).toBe('13:02');
  });

  it('rechaza zonas horarias inválidas', () => {
    expect(() => assertValidTimeZone('Mars/Olympus')).toThrow(RangeError);
  });
});

describe('RF-02 / RNF-06.2-3 · Ventana, proyección punto-segmento y hash', () => {
  it('recorta la polilínea en [60, 120]', () => {
    const c = sliceRouteByWindow(POLY, 60, 120, 6);
    expect(c.polyline[0].cumulativeMinutes).toBeCloseTo(60, 1);
    expect(c.polyline[c.polyline.length - 1].cumulativeMinutes).toBeCloseTo(120, 1);
  });

  it('dos ventanas distintas sobre la misma ruta generan hashes distintos', () => {
    expect(sliceRouteByWindow(POLY, 60, 120, 6).corridorHash).not.toBe(
      sliceRouteByWindow(POLY, 90, 150, 6).corridorHash
    );
  });

  it('proyecta sobre el segmento (no solo vértices) y calcula el minuto interpolado', () => {
    // Punto a mitad del segmento 1→2, desplazado ~0,5 km
    const p = projectPointOnPolyline({ lat: 39.925 + 0.004, lon: -2.825 }, POLY);
    expect(p.distanceKm).toBeLessThan(1);
    expect(p.alongMinutes).toBeGreaterThan(50);
    expect(p.alongMinutes).toBeLessThan(60);
    expect(p.isBeforeStart).toBe(false);
  });

  it('marca como "detrás del origen" una parada a <1 km por detrás de la posición GPS', () => {
    // Prolongación del primer segmento hacia atrás (dirección opuesta a la marcha)
    const behind = { lat: 40.4168 + 0.004, lon: -3.7038 - 0.0068 };
    const p = projectPointOnPolyline(behind, POLY);
    expect(p.distanceKm).toBeLessThan(1);
    expect(p.isBeforeStart).toBe(true);
  });
});

describe('RF-04 · Desvío según el tipo de acceso', () => {
  it('penaliza TOWN_ENTRY más que DIRECT_SERVICE_AREA', () => {
    const pre = { lat: 39.86, lon: -2.66 };
    const post = { lat: 39.84, lon: -2.64 };
    const s = { lat: 39.8505, lon: -2.6505 };
    const direct = calculateGeometricRoundTripDetour(pre, s, post, 0.15, 'DIRECT_SERVICE_AREA');
    const town = calculateGeometricRoundTripDetour(pre, s, post, 1.8, 'TOWN_ENTRY');
    expect(direct.detourMinutes).toBeLessThan(town.detourMinutes);
    expect(computeDetourSubScore(direct.detourMinutes)).toBeGreaterThan(computeDetourSubScore(town.detourMinutes));
  });
});

describe('RF-05 / RNF-04.3 · Bayesiana y tratamiento neutro de lo desconocido', () => {
  it('4,5★ con 800 reseñas supera a 4,9★ con 5', () => {
    expect(computeBayesianRating(4.5, 800)).toBeGreaterThan(computeBayesianRating(4.9, 5));
    expect(computeBayesianRating(4.9, 5)).toBeCloseTo(3.9, 1);
  });

  it('una nota desconocida (null) equivale al prior C, no a una nota inventada', () => {
    expect(computeBayesianRating(null, 0)).toBe(BAYESIAN_PRIOR_MEAN_C);
    expect(computeQualitySubScore(computeBayesianRating(null, 0))).toBeCloseTo(52, 0);
  });

  it('un servicio desconocido (null) no puntúa ni satisface un filtro obligatorio', () => {
    const unknown = { ...BASE_STOP, amenities: { ...BASE_STOP.amenities, hasEvChargerNearby: null } };
    expect(matchesSearchFilters(unknown, 2, { requiredAmenities: { hasEvChargerNearby: true } })).toBe(false);
    expect(computeAmenitiesSubScore(unknown.amenities)).toBeLessThan(computeAmenitiesSubScore(BASE_STOP.amenities));
  });

  it('un precio desconocido no pasa un filtro "solo €"', () => {
    expect(matchesSearchFilters({ ...BASE_STOP, priceLevel: null }, 2, { maxPriceLevel: 1 })).toBe(false);
  });

  it('evalúa la parada con hora local correcta y enlaces de navegación (RF-06)', () => {
    const e = evaluateCandidateStop({
      stop: BASE_STOP,
      distanceFromOriginKm: 103,
      etaMinutesFromStart: 62,
      departureTimeIso: '2026-11-10T12:00:00.000Z', // 13:00 Madrid
      timeZone: 'Europe/Madrid',
      detourTimeMinutes: 2,
      detourDistanceKm: 0.6,
      perpendicularDistanceKm: 0.25,
      windowMinMinutes: 45,
      windowMaxMinutes: 90,
      destinationCoord: { lat: 39.4699, lon: -0.3763 },
    });
    expect(e.scoring.optiStopScore).toBeGreaterThan(75);
    expect(e.routeMetrics.estimatedArrivalClock).toBe('14:02');
    expect(e.navigationLinks.googleMapsUrl).toContain('waypoints=39.85100,-2.65100');
  });
});
