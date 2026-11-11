import { describe, expect, it } from 'vitest';
import { FindOptimalStopsUseCase } from '@/application/use-cases/find-optimal-stops.use-case';
import { FileStopRepository } from '@/infrastructure/persistence/file-stop.repository';
import { IExternalStopProviderPort } from '@/domain/models/ports';
import { OptimalStopsRequest } from '@/domain/models/types';
import { FakeA3RoutingPort } from '../helpers/fake-routing';

const MADRID_VALENCIA: OptimalStopsRequest = {
  mode: 'PLANNING',
  origin: { label: 'Madrid', lat: 40.4168, lon: -3.7038 },
  destination: { label: 'Valencia', lat: 39.4699, lon: -0.3763 },
  departureTimeIso: '2026-11-10T11:30:00.000Z', // 12:30 Madrid
  timeZone: 'Europe/Madrid',
  stopWindow: { type: 'CLOCK_RANGE', clockStartHHMM: '14:00', clockEndHHMM: '15:00' },
  limit: 5,
};

describe('Spec 01 §4 · Escenarios Gherkin (routing determinista, RNF-06.4)', () => {
  it('Escenario 1: comer entre 14:00 y 15:00 saliendo de Madrid a las 12:30 hacia Valencia', async () => {
    const uc = new FindOptimalStopsUseCase(
      new FakeA3RoutingPort(),
      new FileStopRepository({ dataDir: null, includeDemo: true }),
      []
    );
    const res = await uc.execute(MADRID_VALENCIA);

    expect(res.windowInfo.minMinutes).toBe(90);
    expect(res.windowInfo.maxMinutes).toBe(150);
    expect(res.windowInfo.windowStartClock).toBe('14:00');
    expect(res.optimalStops.length).toBeGreaterThanOrEqual(3);
    expect(res.optimalStops.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < res.optimalStops.length; i++) {
      expect(res.optimalStops[i - 1].scoring.optiStopScore).toBeGreaterThanOrEqual(
        res.optimalStops[i].scoring.optiStopScore
      );
    }
    for (const s of res.optimalStops) {
      // Dentro de la ventana pedida (con tolerancia de 10 min por la salida)
      expect(s.routeMetrics.etaMinutesFromStart).toBeGreaterThanOrEqual(80);
      expect(s.routeMetrics.etaMinutesFromStart).toBeLessThanOrEqual(160);
      expect(s.routeMetrics.detourTimeMinutes).toBeGreaterThanOrEqual(1);
      expect(s.navigationLinks.wazeUrl).toContain('waze.com/ul');
    }
    // RNF-04.6: los datos demo quedan señalados en la respuesta
    expect(res.telemetry.warnings.some((w) => w.code === 'DEMO_DATA')).toBe(true);
  });

  it('Escenario 2: en ruta pasado Tarancón, con cargador EV obligatorio, sin paradas ya superadas', async () => {
    const uc = new FindOptimalStopsUseCase(
      new FakeA3RoutingPort(),
      new FileStopRepository({ dataDir: null, includeDemo: true }),
      []
    );
    const res = await uc.execute({
      ...MADRID_VALENCIA,
      mode: 'EN_ROUTE',
      origin: { label: 'GPS', lat: 39.96, lon: -2.91 },
      departureTimeIso: undefined,
      stopWindow: { type: 'TIME_FROM_START', minMinutesFromStart: 10, maxMinutesFromStart: 60 },
      filters: { requiredAmenities: { hasEvChargerNearby: true } },
    });
    expect(res.optimalStops.length).toBeGreaterThan(0);
    for (const s of res.optimalStops) {
      expect(s.amenities.hasEvChargerNearby).toBe(true);
      expect(s.id).not.toMatch(/^a3-pk(62|82)-/); // Belinchón y Tarancón quedaron atrás
    }
  });
});

describe('RNF-04.5 · Telemetría de coste basada en llamadas reales', () => {
  it('suma el coste que declaran los proveedores y no marca cache hit si se llamó a terceros', async () => {
    const paidProvider: IExternalStopProviderPort = {
      providerName: 'GOOGLE_PLACES_QUOTA_GUARDED',
      discoverStopsInCorridor: async () => ({ stops: [], billableCalls: 1, estimatedCostUsd: 0.035 }),
    };
    const uc = new FindOptimalStopsUseCase(
      new FakeA3RoutingPort(),
      new FileStopRepository({ dataDir: null, includeDemo: false }), // BD vacía → tiene que salir fuera
      [paidProvider]
    );
    const res = await uc.execute(MADRID_VALENCIA);
    expect(res.telemetry.corridorCacheHit).toBe(false);
    expect(res.telemetry.billableCalls).toBe(1);
    expect(res.telemetry.estimatedApiCostUsd).toBeCloseTo(0.035, 3);

    const second = await uc.execute(MADRID_VALENCIA);
    expect(second.telemetry.corridorCacheHit).toBe(true);
    expect(second.telemetry.billableCalls).toBe(0);
  });
});
