import a1 from '../../../data/corridors/a1.json';
import a2 from '../../../data/corridors/a2.json';
import a3 from '../../../data/corridors/a3.json';
import a4 from '../../../data/corridors/a4.json';
import a5 from '../../../data/corridors/a5.json';
import a6 from '../../../data/corridors/a6.json';
import a66 from '../../../data/corridors/a66.json';
import a7 from '../../../data/corridors/a7.json';
import a8 from '../../../data/corridors/a8.json';
import a92 from '../../../data/corridors/a92.json';
import ap68 from '../../../data/corridors/ap68.json';
import ap7 from '../../../data/corridors/ap7.json';
import { IRoutingPort, RouteComputation } from '@/domain/models/ports';
import {
  AccessType,
  Coordinates,
  RouteVertex,
} from '@/domain/models/types';
import { haversineDistanceKm } from '@/domain/geometry/corridor-slicer';
import { calculateGeometricRoundTripDetour } from '@/domain/scoring/detour-calculator';

interface CorridorFixture {
  id: string;
  from?: { label: string; lat: number; lon: number };
  to?: { label: string; lat: number; lon: number };
  distanceKm: number;
  durationMin: number;
  coords: number[][];
}

const CORRIDOR_FIXTURES: CorridorFixture[] = [
  a1,
  a2,
  a3,
  a4,
  a5,
  a6,
  a66,
  a7,
  a8,
  a92,
  ap68,
  ap7,
];

export interface OSRMRoutingAdapterOptions {
  baseUrl?: string | null;
  timeoutMs?: number;
}

/**
 * Adaptador de Rutas (RNF-04.4 y RNF-07.3):
 * 1. OSRM en vivo (si `baseUrl` está activo).
 * 2. Geometrías reales pregrabadas de corredores (`CORRIDOR_FIXTURE`, `precision: 'HIGH'`) — NUNCA usa coordenadas de paradas.
 * 3. Línea recta con aviso explícito (`STRAIGHT_LINE`, `precision: 'LOW'`) fuera de corredores conocidos.
 */
export class OSRMRoutingAdapter implements IRoutingPort {
  private readonly baseUrl: string | null;
  private readonly timeoutMs: number;
  private readonly routeCache = new Map<string, RouteComputation>();

  constructor(options?: OSRMRoutingAdapterOptions | string, timeoutMs = 4000) {
    if (typeof options === 'string') {
      this.baseUrl = options === 'disabled' ? null : options;
      this.timeoutMs = timeoutMs;
    } else {
      const envUrl = process.env.OSRM_BASE_URL;
      const rawUrl =
        options?.baseUrl !== undefined
          ? options.baseUrl
          : envUrl !== undefined
          ? envUrl
          : 'https://router.project-osrm.org';
      this.baseUrl =
        rawUrl === null || rawUrl === 'disabled' || rawUrl.trim() === ''
          ? null
          : rawUrl;
      this.timeoutMs = options?.timeoutMs ?? timeoutMs;
    }
  }

  async computeRoute(
    origin: Coordinates,
    destination: Coordinates
  ): Promise<RouteComputation> {
    const cacheKey = `${origin.lat.toFixed(3)},${origin.lon.toFixed(
      3
    )}->${destination.lat.toFixed(3)},${destination.lon.toFixed(3)}`;
    const cached = this.routeCache.get(cacheKey);
    if (cached) return cached;

    if (this.baseUrl) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);

        const url = `${this.baseUrl}/route/v1/driving/${origin.lon},${origin.lat};${destination.lon},${destination.lat}?overview=full&geometries=geojson`;
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            Accept: 'application/json',
            'User-Agent': 'OptiStopCarreteras/1.1',
          },
        });
        clearTimeout(timer);

        if (response.ok) {
          const data = await response.json();
          const route = data?.routes?.[0];
          const coords: [number, number][] | undefined =
            route?.geometry?.coordinates;

          if (coords && coords.length >= 2) {
            const totalDurationMinutes = Math.max(
              5,
              Math.round((route.duration ?? 3600) / 60)
            );
            const totalDistanceKm = Math.max(
              5,
              Math.round((route.distance ?? 100_000) / 1000)
            );

            // Submuestreo por distancia (~2 km) para preservar fidelidad en rutas largas
            const sampled: Coordinates[] = [
              { lat: coords[0][1], lon: coords[0][0] },
            ];
            let accKm = 0;
            for (let i = 1; i < coords.length; i++) {
              const prev = { lat: coords[i - 1][1], lon: coords[i - 1][0] };
              const curr = { lat: coords[i][1], lon: coords[i][0] };
              accKm += haversineDistanceKm(prev, curr);
              if (accKm >= 2.0) {
                sampled.push(curr);
                accKm = 0;
              }
            }
            const lastCoord = coords[coords.length - 1];
            sampled.push({ lat: lastCoord[1], lon: lastCoord[0] });

            const polyline = this.buildCumulativePolyline(
              sampled,
              totalDistanceKm,
              totalDurationMinutes
            );

            const result: RouteComputation = {
              totalDurationMinutes,
              totalDistanceKm,
              polyline,
              provider: 'OSRM_LIVE',
              precision: 'HIGH',
            };
            this.routeCache.set(cacheKey, result);
            return result;
          }
        }
      } catch {
        // Continúa al corredor pregrabado o línea recta
      }
    }

    const matchedCorridor = this.matchPreRecordedCorridor(origin, destination);
    if (matchedCorridor) {
      this.routeCache.set(cacheKey, matchedCorridor);
      return matchedCorridor;
    }

    const straight = this.computeStraightLineFallback(origin, destination);
    this.routeCache.set(cacheKey, straight);
    return straight;
  }

  async estimateRoundTripDetourMinutes(
    corridorPointPre: Coordinates,
    stopCoord: Coordinates,
    corridorPointPost: Coordinates,
    accessType: AccessType,
    perpendicularDistanceKm?: number
  ): Promise<{ detourMinutes: number; detourDistanceKm: number }> {
    const mid: Coordinates = {
      lat: (corridorPointPre.lat + corridorPointPost.lat) / 2,
      lon: (corridorPointPre.lon + corridorPointPost.lon) / 2,
    };
    const perpKm =
      typeof perpendicularDistanceKm === 'number'
        ? perpendicularDistanceKm
        : haversineDistanceKm(mid, stopCoord);

    return calculateGeometricRoundTripDetour(
      corridorPointPre,
      stopCoord,
      corridorPointPost,
      perpKm,
      accessType
    );
  }

  private matchPreRecordedCorridor(
    origin: Coordinates,
    destination: Coordinates
  ): RouteComputation | null {
    for (const fixture of CORRIDOR_FIXTURES) {
      const pts = fixture.coords.map(([lat, lon]) => ({ lat, lon }));
      let origIdx = 0;
      let minOrigDist = Infinity;
      let destIdx = pts.length - 1;
      let minDestDist = Infinity;

      pts.forEach((pt, idx) => {
        const dOrig = haversineDistanceKm(origin, pt);
        if (dOrig < minOrigDist) {
          minOrigDist = dOrig;
          origIdx = idx;
        }
        const dDest = haversineDistanceKm(destination, pt);
        if (dDest < minDestDist) {
          minDestDist = dDest;
          destIdx = idx;
        }
      });

      // Si tanto el origen como el destino caen a menos de 18 km del corredor pregrabado
      if (minOrigDist <= 18 && minDestDist <= 18 && origIdx !== destIdx) {
        const forward = origIdx < destIdx;
        const slicedPts = forward
          ? pts.slice(origIdx, destIdx + 1)
          : pts.slice(destIdx, origIdx + 1).reverse();

        if (slicedPts.length >= 2) {
          let sumKm = 0;
          for (let i = 1; i < slicedPts.length; i++) {
            sumKm += haversineDistanceKm(slicedPts[i - 1], slicedPts[i]);
          }
          const ratio = Math.min(1, sumKm / Math.max(1, fixture.distanceKm));
          const totalDistanceKm = Math.max(
            10,
            Math.round(fixture.distanceKm * ratio)
          );
          const totalDurationMinutes = Math.max(
            8,
            Math.round(fixture.durationMin * ratio)
          );

          const polyline = this.buildCumulativePolyline(
            slicedPts,
            totalDistanceKm,
            totalDurationMinutes
          );

          return {
            totalDistanceKm,
            totalDurationMinutes,
            polyline,
            provider: 'CORRIDOR_FIXTURE',
            precision: 'HIGH',
          };
        }
      }
    }
    return null;
  }

  private computeStraightLineFallback(
    origin: Coordinates,
    destination: Coordinates
  ): RouteComputation {
    const straightKm = haversineDistanceKm(origin, destination);
    const totalDistanceKm = Math.max(10, Math.round(straightKm * 1.2));
    const totalDurationMinutes = Math.max(
      10,
      Math.round(totalDistanceKm / 1.65)
    );

    const steps = 32;
    const points: Coordinates[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      points.push({
        lat: origin.lat + (destination.lat - origin.lat) * t,
        lon: origin.lon + (destination.lon - origin.lon) * t,
      });
    }

    return {
      totalDistanceKm,
      totalDurationMinutes,
      polyline: this.buildCumulativePolyline(
        points,
        totalDistanceKm,
        totalDurationMinutes
      ),
      provider: 'STRAIGHT_LINE',
      precision: 'LOW',
    };
  }

  private buildCumulativePolyline(
    points: Coordinates[],
    totalDistanceKm: number,
    totalDurationMinutes: number
  ): RouteVertex[] {
    const segDists: number[] = [0];
    let sumRawKm = 0;

    for (let i = 1; i < points.length; i++) {
      const d = haversineDistanceKm(points[i - 1], points[i]);
      sumRawKm += d;
      segDists.push(sumRawKm);
    }

    const normTotal = sumRawKm > 0 ? sumRawKm : 1;
    return points.map((pt, idx) => {
      const ratio = segDists[idx] / normTotal;
      return {
        lat: pt.lat,
        lon: pt.lon,
        cumulativeKm: Number((ratio * totalDistanceKm).toFixed(1)),
        cumulativeMinutes: Number((ratio * totalDurationMinutes).toFixed(1)),
      };
    });
  }
}
