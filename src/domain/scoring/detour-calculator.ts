import { AccessType, Coordinates } from '../models/types';
import { haversineDistanceKm } from '../geometry/corridor-slicer';

/**
 * Penalizaciones de maniobra según el tipo de acceso en la vía
 * (Definido en specs/02-domain-and-scoring-spec.md §2.2)
 */
export const ACCESS_MANEUVER_PENALTY_MINUTES: Record<AccessType, number> = {
  DIRECT_SERVICE_AREA: 0.0,         // Área en la propia vía con acceso directo
  HIGHWAY_EXIT_EASY: 1.5,           // Salida inmediata con rotonda a < 800m
  OPPOSITE_DIRECTION_OVERPASS: 2.5, // Cambio de sentido por paso elevado
  TOWN_ENTRY: 3.0,                  // Entrada a casco urbano de pueblo cercano
};

/**
 * Calcula el tiempo real de desvío ida y vuelta (en minutos) y distancia extra (en km)
 * para salir de la carretera principal, llegar a la parada y reincorporarse en el sentido de la marcha.
 */
export function calculateGeometricRoundTripDetour(
  corridorPointPre: Coordinates,
  stopCoord: Coordinates,
  corridorPointPost: Coordinates,
  perpendicularDistanceKm: number,
  accessType: AccessType
): { detourMinutes: number; detourDistanceKm: number } {
  // Factor de tortuosidad vial en salidas secundarias (~1.32x la distancia en línea recta)
  const ROAD_TORTUOSITY_FACTOR = 1.32;

  const directSegmentKm = haversineDistanceKm(corridorPointPre, corridorPointPost);
  const viaStopKm =
    (haversineDistanceKm(corridorPointPre, stopCoord) +
      haversineDistanceKm(stopCoord, corridorPointPost)) *
    ROAD_TORTUOSITY_FACTOR;

  // Distancia extra ida y vuelta (mínimo 2 * perpendicularDistanceKm si pre y post coinciden)
  const rawExtraKm = Math.max(
    perpendicularDistanceKm * 2 * ROAD_TORTUOSITY_FACTOR,
    viaStopKm - directSegmentKm
  );

  // Si es un área de servicio en la propia autovía a < 250m, el desvío físico es prácticamente nulo
  const effectiveExtraKm =
    accessType === 'DIRECT_SERVICE_AREA' && perpendicularDistanceKm <= 0.35
      ? 0.2
      : rawExtraKm;

  // Velocidad media en ramales de salida/vía secundaria (~50 km/h -> 0.833 km/min)
  const SECONDARY_ROAD_SPEED_KM_PER_MIN = 0.85;
  const drivingExtraMinutes = effectiveExtraKm / SECONDARY_ROAD_SPEED_KM_PER_MIN;
  const maneuverPenalty = ACCESS_MANEUVER_PENALTY_MINUTES[accessType] ?? 1.5;

  const totalDetourMinutes = Math.max(
    accessType === 'DIRECT_SERVICE_AREA' ? 1 : 2,
    Math.round(drivingExtraMinutes + maneuverPenalty)
  );

  return {
    detourMinutes: totalDetourMinutes,
    detourDistanceKm: Number(effectiveExtraKm.toFixed(1)),
  };
}

/**
 * Función de decaimiento exponencial para el sub-score de Desvío D_score(S) in [0, 100]
 * D_score(S) = 100 * e^(-0.14 * detourMinutes)
 * (Definido en specs/02-domain-and-scoring-spec.md §5)
 */
export function computeDetourSubScore(detourMinutes: number): number {
  const effectiveDetour = Math.max(0, detourMinutes);
  const raw = 100 * Math.exp(-0.14 * effectiveDetour);
  return Number(Math.max(0, Math.min(100, raw)).toFixed(1));
}
