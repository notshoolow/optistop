import {
  IExternalStopProviderPort,
  IRoutingPort,
  IStopCacheRepositoryPort,
} from '@/domain/models/ports';
import {
  EvaluatedOptimalStop,
  OptimalStopsRequest,
  OptimalStopsResponse,
  RoadStopEntity,
  StopSource,
  TelemetryWarning,
} from '@/domain/models/types';
import {
  projectPointOnPolyline,
  projectStopOntoCorridor,
  resolveStopWindowBounds,
  sliceRouteByWindow,
} from '@/domain/geometry/corridor-slicer';
import {
  addMinutesAsClock,
  assertValidTimeZone,
  DEFAULT_TIME_ZONE,
} from '@/domain/time/clock';
import {
  evaluateCandidateStop,
  matchesSearchFilters,
} from '@/domain/scoring/optistop-scorer';

export class FindOptimalStopsUseCase {
  constructor(
    private readonly routingPort: IRoutingPort,
    private readonly cacheRepo: IStopCacheRepositoryPort,
    private readonly externalProviders: IExternalStopProviderPort[] = [],
    private readonly getQuotaRemainingFn: () => Promise<number> | number = () =>
      900
  ) {}

  async execute(request: OptimalStopsRequest): Promise<OptimalStopsResponse> {
    const startTimeMs = Date.now();
    const limit = Math.max(1, Math.min(8, request.limit ?? 5));
    const timeZone = assertValidTimeZone(
      request.timeZone ?? DEFAULT_TIME_ZONE
    );
    const departureTimeIso =
      request.departureTimeIso ?? new Date().toISOString();

    // 1. Trazado de la ruta principal
    const route = await this.routingPort.computeRoute(
      request.origin,
      request.destination
    );

    // 2. Resolución de la Ventana de Parada independiente de la zona del servidor (RNF-06.1)
    const windowBounds = resolveStopWindowBounds(
      route.polyline,
      request.stopWindow,
      departureTimeIso,
      timeZone
    );

    const corridor = sliceRouteByWindow(
      route.polyline,
      windowBounds.minMinutes,
      windowBounds.maxMinutes,
      12.0
    );

    // 3. Consulta Cache-First honesta (RNF-04.5)
    const corridorAlreadyCached =
      await this.cacheRepo.hasFreshCorridorCoverage(corridor.corridorHash);
    let candidates = await this.cacheRepo.findStopsInCorridor(corridor);

    let billableCalls = 0;
    let estimatedApiCostUsd = 0;
    let corridorCacheHit = corridorAlreadyCached;

    // 4. Read-Through Enrichment solo si el corredor no está cacheado y tiene < 3 paradas
    if (!corridorAlreadyCached && candidates.length < 3) {
      if (this.externalProviders.length > 0) {
        const newlyDiscovered: RoadStopEntity[] = [];

        for (const provider of this.externalProviders) {
          const result = await provider.discoverStopsInCorridor(corridor);
          billableCalls += result.billableCalls;
          estimatedApiCostUsd += result.estimatedCostUsd;

          for (const ext of result.stops) {
            if (
              !candidates.some((c) => c.id === ext.id || c.name === ext.name) &&
              !newlyDiscovered.some((n) => n.id === ext.id)
            ) {
              newlyDiscovered.push(ext);
            }
          }
        }

        const merged = [...candidates, ...newlyDiscovered];
        await this.cacheRepo.saveOrUpdateStops(merged, corridor.corridorHash);
        candidates = merged;
      } else {
        await this.cacheRepo.saveOrUpdateStops(
          candidates,
          corridor.corridorHash
        );
      }
      corridorCacheHit = false;
    } else if (!corridorAlreadyCached && candidates.length >= 3) {
      await this.cacheRepo.saveOrUpdateStops(candidates, corridor.corridorHash);
      corridorCacheHit = true;
    }

    // Si en una ventana estrecha hay menos de 3 candidatos, ampliamos suavemente la ventana (±25 min)
    if (candidates.length < 3) {
      const expandedCorridor = sliceRouteByWindow(
        route.polyline,
        Math.max(0, windowBounds.minMinutes - 25),
        Math.min(route.totalDurationMinutes, windowBounds.maxMinutes + 25),
        16.0
      );
      const expandedCandidates =
        await this.cacheRepo.findStopsInCorridor(expandedCorridor);
      for (const extra of expandedCandidates) {
        if (!candidates.some((c) => c.id === extra.id)) {
          candidates.push(extra);
        }
      }
    }

    // 5. Evaluación de Desvío Real, Filtrado de Dirección en Ruta y OptiStopScore
    const evaluatedList: EvaluatedOptimalStop[] = [];
    const sourcesBreakdown: Record<StopSource, number> = {
      CURATED_DB: 0,
      OSM_ENRICHED: 0,
      GOOGLE_CACHED: 0,
      COMMUNITY: 0,
    };

    for (const stop of candidates) {
      sourcesBreakdown[stop.source] =
        (sourcesBreakdown[stop.source] ?? 0) + 1;

      // RNF-06.2: Verificamos sobre la ruta completa que no esté detrás del punto de inicio / GPS
      const fullProj = projectPointOnPolyline(stop.coordinates, route.polyline);
      if (fullProj.isBeforeStart) {
        continue;
      }
      if (request.mode === 'EN_ROUTE' && fullProj.alongMinutes < 2) {
        continue;
      }

      const windowProj = projectStopOntoCorridor(
        stop.coordinates,
        corridor.polyline.length >= 2 ? corridor.polyline : route.polyline,
        18.0
      );

      if (!windowProj.isAheadInRouteDirection) {
        continue;
      }

      const detour = await this.routingPort.estimateRoundTripDetourMinutes(
        fullProj.prePoint,
        stop.coordinates,
        fullProj.postPoint,
        stop.accessType,
        fullProj.distanceKm
      );

      if (!matchesSearchFilters(stop, detour.detourMinutes, request.filters)) {
        continue;
      }

      const evaluated = evaluateCandidateStop({
        stop,
        distanceFromOriginKm: Math.round(fullProj.alongKm),
        etaMinutesFromStart: Math.round(fullProj.alongMinutes),
        departureTimeIso,
        timeZone,
        detourTimeMinutes: detour.detourMinutes,
        detourDistanceKm: detour.detourDistanceKm,
        perpendicularDistanceKm: fullProj.distanceKm,
        windowMinMinutes: windowBounds.minMinutes,
        windowMaxMinutes: windowBounds.maxMinutes,
        destinationCoord: request.destination,
        filters: request.filters,
      });

      evaluatedList.push(evaluated);
    }

    evaluatedList.sort(
      (a, b) => b.scoring.optiStopScore - a.scoring.optiStopScore
    );
    const optimalStops = evaluatedList.slice(0, limit);

    // 6. Avisos de integridad y precisión para la UI (RNF-04.6)
    const warnings: TelemetryWarning[] = [];
    if (optimalStops.some((s) => s.dataQuality === 'DEMO_UNVERIFIED')) {
      warnings.push({
        code: 'DEMO_DATA',
        message:
          'Los resultados incluyen paradas del catálogo de demostración pendientes de verificación comercial.',
      });
    }
    if (optimalStops.some((s) => s.dataQuality === 'UNVERIFIED_OSM')) {
      warnings.push({
        code: 'UNVERIFIED_OSM_DATA',
        message:
          'Algunas paradas provienen de OpenStreetMap y no disponen aún de valoraciones ni precios verificados.',
      });
    }
    if (route.precision === 'LOW') {
      warnings.push({
        code: 'LOW_PRECISION_ROUTE',
        message:
          'Ruta aproximada en línea recta (servidor OSRM no disponible): los tiempos de desvío son estimados.',
      });
    }

    const responseTimeMs = Math.max(1, Date.now() - startTimeMs);
    const quotaRemainingMonthly = await this.getQuotaRemainingFn();

    return {
      routeSummary: {
        originLabel: request.origin.label,
        destinationLabel: request.destination.label,
        totalDurationMinutes: route.totalDurationMinutes,
        totalDistanceKm: route.totalDistanceKm,
        fullPolyline: route.polyline,
        windowPolyline: corridor.polyline,
        routingProvider: route.provider,
        precision: route.precision,
      },
      windowInfo: {
        minMinutes: Math.round(windowBounds.minMinutes),
        maxMinutes: Math.round(windowBounds.maxMinutes),
        minKm: Math.round(windowBounds.minKm),
        maxKm: Math.round(windowBounds.maxKm),
        windowStartClock: addMinutesAsClock(
          departureTimeIso,
          windowBounds.minMinutes,
          timeZone
        ),
        windowEndClock: addMinutesAsClock(
          departureTimeIso,
          windowBounds.maxMinutes,
          timeZone
        ),
        corridorHash: corridor.corridorHash,
      },
      telemetry: {
        corridorCacheHit,
        cacheHit: corridorCacheHit,
        totalCandidatesEvaluated: candidates.length,
        sourcesBreakdown,
        billableCalls,
        estimatedApiCostUsd: Number(estimatedApiCostUsd.toFixed(4)),
        responseTimeMs,
        quotaRemainingMonthly,
        warnings,
      },
      optimalStops,
    };
  }
}
