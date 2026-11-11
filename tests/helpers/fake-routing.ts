import a3 from '../../data/corridors/a3.json';
import { IRoutingPort, RouteComputation } from '@/domain/models/ports';
import { AccessType, Coordinates, RouteVertex } from '@/domain/models/types';
import { haversineDistanceKm } from '@/domain/geometry/corridor-slicer';
import { calculateGeometricRoundTripDetour } from '@/domain/scoring/detour-calculator';

/**
 * IRoutingPort determinista para tests (RNF-06.4): sin red, sin DNS, sin timeouts.
 * Usa la geometría real pregrabada de la A-3 y la recorta desde el punto más cercano al origen.
 */
export class FakeA3RoutingPort implements IRoutingPort {
  async computeRoute(origin: Coordinates): Promise<RouteComputation> {
    const pts = a3.coords.map(([lat, lon]) => ({ lat, lon }));
    let startIdx = 0;
    let best = Infinity;
    pts.forEach((p, i) => {
      const d = haversineDistanceKm(origin, p);
      if (d < best) {
        best = d;
        startIdx = i;
      }
    });
    const slice = [origin, ...pts.slice(startIdx + 1)];
    let km = 0;
    const raw: RouteVertex[] = slice.map((p, i) => {
      if (i > 0) km += haversineDistanceKm(slice[i - 1], p);
      return { lat: p.lat, lon: p.lon, cumulativeKm: km, cumulativeMinutes: 0 };
    });
    const minPerKm = a3.durationMin / a3.distanceKm;
    const polyline = raw.map((v) => ({
      ...v,
      cumulativeKm: Number(v.cumulativeKm.toFixed(2)),
      cumulativeMinutes: Number((v.cumulativeKm * minPerKm).toFixed(2)),
    }));
    const last = polyline[polyline.length - 1];
    return {
      totalDistanceKm: Math.round(last.cumulativeKm),
      totalDurationMinutes: Math.round(last.cumulativeMinutes),
      polyline,
      provider: 'CORRIDOR_FIXTURE',
      precision: 'HIGH',
    };
  }

  async estimateRoundTripDetourMinutes(
    pre: Coordinates,
    stop: Coordinates,
    post: Coordinates,
    accessType: AccessType,
    perpendicularDistanceKm: number
  ) {
    return calculateGeometricRoundTripDetour(pre, stop, post, perpendicularDistanceKm, accessType);
  }
}
