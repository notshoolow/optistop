import { CorridorBoundingBox } from '../models/ports';
import {
  Coordinates,
  RouteVertex,
  StopWindowInput,
} from '../models/types';
import {
  addMinutesAsClock,
  DEFAULT_TIME_ZONE,
  getMinutesOfDayInTimeZone,
  parseClockToMinutesOfDay,
} from '../time/clock';

const EARTH_RADIUS_KM = 6371;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Distancia Haversine en kilómetros entre dos coordenadas.
 */
export function haversineDistanceKm(a: Coordinates, b: Coordinates): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_KM * c;
}

export function addMinutesToIsoAsClock(
  iso: string,
  minutesToAdd: number,
  timeZone = DEFAULT_TIME_ZONE
): string {
  return addMinutesAsClock(iso, minutesToAdd, timeZone);
}

/**
 * Normaliza la ventana de parada (por minutos, por reloj o por km) usando la zona IANA del usuario (RNF-06.1).
 */
export function resolveStopWindowBounds(
  polyline: RouteVertex[],
  stopWindow: StopWindowInput,
  departureTimeIso: string,
  timeZone = DEFAULT_TIME_ZONE
): {
  minMinutes: number;
  maxMinutes: number;
  minKm: number;
  maxKm: number;
} {
  if (polyline.length === 0) {
    return { minMinutes: 0, maxMinutes: 60, minKm: 0, maxKm: 100 };
  }

  const totalMinutes = polyline[polyline.length - 1].cumulativeMinutes;
  const totalKm = polyline[polyline.length - 1].cumulativeKm;
  const avgSpeedKmPerMin = totalMinutes > 0 ? totalKm / totalMinutes : 1.5;

  if (stopWindow.type === 'DISTANCE_RANGE') {
    const minKm = Math.max(0, stopWindow.minDistanceKm ?? 30);
    const maxKm = Math.min(
      totalKm,
      Math.max(minKm + 15, stopWindow.maxDistanceKm ?? minKm + 60)
    );
    const minMinutes = Math.max(2, minKm / avgSpeedKmPerMin);
    const maxMinutes = Math.min(totalMinutes, maxKm / avgSpeedKmPerMin);
    return { minMinutes, maxMinutes, minKm, maxKm };
  }

  if (
    stopWindow.type === 'CLOCK_RANGE' &&
    stopWindow.clockStartHHMM &&
    stopWindow.clockEndHHMM
  ) {
    const depDate = new Date(departureTimeIso);
    const depMinsOfDay = Number.isNaN(depDate.getTime())
      ? 12 * 60
      : getMinutesOfDayInTimeZone(depDate, timeZone);

    let startMinsOfDay = parseClockToMinutesOfDay(stopWindow.clockStartHHMM);
    let endMinsOfDay = parseClockToMinutesOfDay(stopWindow.clockEndHHMM);

    if (startMinsOfDay < depMinsOfDay) startMinsOfDay += 24 * 60;
    if (endMinsOfDay < startMinsOfDay) endMinsOfDay += 24 * 60;

    const minMinutes = Math.max(
      5,
      Math.min(totalMinutes - 5, startMinsOfDay - depMinsOfDay)
    );
    const maxMinutes = Math.max(
      minMinutes + 15,
      Math.min(totalMinutes, endMinsOfDay - depMinsOfDay)
    );
    const minKm = minMinutes * avgSpeedKmPerMin;
    const maxKm = maxMinutes * avgSpeedKmPerMin;
    return { minMinutes, maxMinutes, minKm, maxKm };
  }

  // TIME_FROM_START
  const rawMin = stopWindow.minMinutesFromStart ?? 30;
  const rawMax = stopWindow.maxMinutesFromStart ?? 75;
  const minMinutes = Math.max(2, Math.min(totalMinutes - 5, rawMin));
  const maxMinutes = Math.max(minMinutes + 10, Math.min(totalMinutes, rawMax));
  const minKm = minMinutes * avgSpeedKmPerMin;
  const maxKm = maxMinutes * avgSpeedKmPerMin;

  return { minMinutes, maxMinutes, minKm, maxKm };
}

function interpolateVertexAtMinute(
  a: RouteVertex,
  b: RouteVertex,
  targetMinute: number
): RouteVertex {
  const span = b.cumulativeMinutes - a.cumulativeMinutes;
  if (span <= 0) return a;
  const ratio = Math.max(
    0,
    Math.min(1, (targetMinute - a.cumulativeMinutes) / span)
  );
  return {
    lat: a.lat + (b.lat - a.lat) * ratio,
    lon: a.lon + (b.lon - a.lon) * ratio,
    cumulativeMinutes: targetMinute,
    cumulativeKm: a.cumulativeKm + (b.cumulativeKm - a.cumulativeKm) * ratio,
  };
}

/**
 * Extrae la sub-polilínea exacta de la ventana y genera un corridorHash que incluye la ventana (RNF-06.3).
 */
export function sliceRouteByWindow(
  polyline: RouteVertex[],
  minMinutes: number,
  maxMinutes: number,
  maxRadiusKm = 6.0
): CorridorBoundingBox {
  if (polyline.length === 0) {
    return {
      corridorHash: 'empty',
      polyline: [],
      maxRadiusKm,
      minLat: 0,
      maxLat: 0,
      minLon: 0,
      maxLon: 0,
    };
  }

  const sliced: RouteVertex[] = [];

  for (let i = 0; i < polyline.length; i++) {
    const curr = polyline[i];
    const prev = i > 0 ? polyline[i - 1] : null;

    if (
      prev &&
      prev.cumulativeMinutes < minMinutes &&
      curr.cumulativeMinutes >= minMinutes
    ) {
      sliced.push(interpolateVertexAtMinute(prev, curr, minMinutes));
    }

    if (
      curr.cumulativeMinutes >= minMinutes &&
      curr.cumulativeMinutes <= maxMinutes
    ) {
      sliced.push(curr);
    }

    if (
      prev &&
      prev.cumulativeMinutes <= maxMinutes &&
      curr.cumulativeMinutes > maxMinutes
    ) {
      sliced.push(interpolateVertexAtMinute(prev, curr, maxMinutes));
    }
  }

  if (sliced.length < 2 && polyline.length >= 2) {
    for (let i = 1; i < polyline.length; i++) {
      const prev = polyline[i - 1];
      const curr = polyline[i];
      if (
        curr.cumulativeMinutes >= minMinutes &&
        prev.cumulativeMinutes <= maxMinutes
      ) {
        sliced.push(interpolateVertexAtMinute(prev, curr, minMinutes));
        sliced.push(interpolateVertexAtMinute(prev, curr, maxMinutes));
        break;
      }
    }
  }

  const activePoly = sliced.length > 0 ? sliced : polyline;

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;

  for (const pt of activePoly) {
    if (pt.lat < minLat) minLat = pt.lat;
    if (pt.lat > maxLat) maxLat = pt.lat;
    if (pt.lon < minLon) minLon = pt.lon;
    if (pt.lon > maxLon) maxLon = pt.lon;
  }

  const latPad = maxRadiusKm / 111.0;
  const lonPad = maxRadiusKm / 85.0;

  minLat -= latPad;
  maxLat += latPad;
  minLon -= lonPad;
  maxLon += lonPad;

  const first = activePoly[0];
  const last = activePoly[activePoly.length - 1];
  const minBucket = Math.round(minMinutes / 5) * 5;
  const maxBucket = Math.round(maxMinutes / 5) * 5;

  // RNF-06.3: incluye la ventana temporal redondeada a 5 min para evitar colisiones entre ventanas distintas
  const corridorHash = `corridor:${first.lat.toFixed(2)},${first.lon.toFixed(
    2
  )}_${last.lat.toFixed(2)},${last.lon.toFixed(2)}:w${minBucket}-${maxBucket}`;

  return {
    corridorHash,
    polyline: activePoly,
    maxRadiusKm,
    minLat,
    maxLat,
    minLon,
    maxLon,
  };
}

export interface PolylineProjection {
  distanceKm: number;
  alongMinutes: number;
  alongKm: number;
  segmentIndex: number;
  segmentFraction: number;
  isBeforeStart: boolean;
  prePoint: Coordinates;
  postPoint: Coordinates;
}

/**
 * RNF-06.2: Proyección ortogonal continua punto-segmento en coordenadas planas locales (equirectangular).
 * Detecta con precisión si una parada está por detrás del origen (`isBeforeStart: true`)
 * incluso si está a menos de 1 km de distancia física.
 */
export function projectPointOnPolyline(
  point: Coordinates,
  polyline: RouteVertex[]
): PolylineProjection {
  if (polyline.length === 0) {
    return {
      distanceKm: Infinity,
      alongMinutes: 0,
      alongKm: 0,
      segmentIndex: 0,
      segmentFraction: 0,
      isBeforeStart: false,
      prePoint: point,
      postPoint: point,
    };
  }

  if (polyline.length === 1) {
    const d = haversineDistanceKm(point, polyline[0]);
    return {
      distanceKm: d,
      alongMinutes: polyline[0].cumulativeMinutes,
      alongKm: polyline[0].cumulativeKm,
      segmentIndex: 0,
      segmentFraction: 0,
      isBeforeStart: false,
      prePoint: polyline[0],
      postPoint: polyline[0],
    };
  }

  let bestDistanceKm = Infinity;
  let bestAlongMinutes = polyline[0].cumulativeMinutes;
  let bestAlongKm = polyline[0].cumulativeKm;
  let bestSegIdx = 0;
  let bestClampedT = 0;
  let firstSegmentDotKm = 0;

  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const cosLat = Math.cos(toRadians((a.lat + b.lat) / 2));

    // Vectores en kilómetros locales respecto a `a`
    const vx = (b.lon - a.lon) * cosLat * 111.32;
    const vy = (b.lat - a.lat) * 111.32;
    const wx = (point.lon - a.lon) * cosLat * 111.32;
    const wy = (point.lat - a.lat) * 111.32;

    const segLenSq = vx * vx + vy * vy;
    const segLenKm = Math.sqrt(segLenSq);
    const rawT = segLenSq > 1e-9 ? (wx * vx + wy * vy) / segLenSq : 0;
    if (i === 0 && segLenKm > 1e-6) {
      // Proyección escalar en km sobre la dirección de salida (negativa = detrás del origen)
      firstSegmentDotKm = (wx * vx + wy * vy) / segLenKm;
    }

    const clampedT = Math.max(0, Math.min(1, rawT));
    const projCoord: Coordinates = {
      lat: a.lat + (b.lat - a.lat) * clampedT,
      lon: a.lon + (b.lon - a.lon) * clampedT,
    };

    const distKm = haversineDistanceKm(point, projCoord);
    if (distKm < bestDistanceKm) {
      bestDistanceKm = distKm;
      bestSegIdx = i;
      bestClampedT = clampedT;
      bestAlongMinutes =
        a.cumulativeMinutes +
        (b.cumulativeMinutes - a.cumulativeMinutes) * clampedT;
      bestAlongKm =
        a.cumulativeKm + (b.cumulativeKm - a.cumulativeKm) * clampedT;
    }
  }

  // Una parada está por detrás del origen si su proyección cae antes del vértice 0 por más de 50 metros
  const isBeforeStart =
    bestSegIdx === 0 && bestClampedT === 0 && firstSegmentDotKm < -0.05;

  return {
    distanceKm: Number(bestDistanceKm.toFixed(2)),
    alongMinutes: Number(bestAlongMinutes.toFixed(1)),
    alongKm: Number(bestAlongKm.toFixed(1)),
    segmentIndex: bestSegIdx,
    segmentFraction: Number(bestClampedT.toFixed(3)),
    isBeforeStart,
    prePoint: polyline[bestSegIdx],
    postPoint: polyline[Math.min(polyline.length - 1, bestSegIdx + 1)],
  };
}

export interface StopProjectionResult {
  isWithinCorridor: boolean;
  isAheadInRouteDirection: boolean;
  perpendicularDistanceKm: number;
  etaMinutesFromStart: number;
  distanceFromOriginKm: number;
  prePoint: Coordinates;
  postPoint: Coordinates;
}

/**
 * Proyecta una parada candidata sobre la sub-polilínea de la ventana activa.
 */
export function projectStopOntoCorridor(
  stopCoord: Coordinates,
  windowPolyline: RouteVertex[],
  maxRadiusKm = 6.0
): StopProjectionResult {
  const proj = projectPointOnPolyline(stopCoord, windowPolyline);
  const isAheadInRouteDirection = !proj.isBeforeStart;

  return {
    isWithinCorridor:
      proj.distanceKm <= maxRadiusKm && isAheadInRouteDirection,
    isAheadInRouteDirection,
    perpendicularDistanceKm: proj.distanceKm,
    etaMinutesFromStart: Math.round(proj.alongMinutes),
    distanceFromOriginKm: Math.round(proj.alongKm),
    prePoint: proj.prePoint,
    postPoint: proj.postPoint,
  };
}
