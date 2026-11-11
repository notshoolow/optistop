import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';

process.env.OPTISTOP_DATA_DIR = ':memory:';
process.env.OSRM_BASE_URL = 'disabled';
process.env.OVERPASS_URL = 'disabled';
process.env.ADMIN_API_TOKEN = 'test-admin-token-0123456789abcdef';

const { resetContainerForTests, createStopRepositoryFromEnv } = await import('@/infrastructure/container');
const { SupabaseStopRepository } = await import('@/infrastructure/persistence/supabase-stop.repository');
const { FileStopRepository } = await import('@/infrastructure/persistence/file-stop.repository');
const searchRoute = await import('@/app/api/routes/optimal-stops/route');
const stopsRoute = await import('@/app/api/stops/route');
const approveRoute = await import('@/app/api/stops/[id]/approve/route');
const deleteStopRoute = await import('@/app/api/stops/[id]/route');

function req(url: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) {
  return new NextRequest(new URL(url, 'http://localhost'), {
    method: init?.method ?? 'GET',
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7', ...init?.headers },
  });
}

const VALID_SEARCH = {
  mode: 'PLANNING',
  origin: { label: 'Madrid', lat: 40.4168, lon: -3.7038 },
  destination: { label: 'Valencia', lat: 39.4699, lon: -0.3763 },
  departureTimeIso: '2026-11-10T11:30:00.000Z',
  timeZone: 'Europe/Madrid',
  stopWindow: { type: 'TIME_FROM_START', minMinutesFromStart: 60, maxMinutesFromStart: 120 },
};

const VALID_STOP = {
  name: 'Venta del Test',
  highwayCode: 'A-3',
  kmMarker: 110,
  locality: 'Saelices',
  coordinates: { lat: 39.92, lon: -2.8 },
  category: 'RESTAURANT',
  accessType: 'HIGHWAY_EXIT_EASY',
  priceLevel: 1,
};

beforeEach(() => resetContainerForTests());

describe('RNF-05.1 · Validación estricta de entradas', () => {
  it('acepta una búsqueda válida', async () => {
    const res = await searchRoute.POST(req('/api/routes/optimal-stops', { method: 'POST', body: VALID_SEARCH }));
    expect(res.status).toBe(200);
  });

  it('rechaza coordenadas fuera de España (lat 999) con 422', async () => {
    const res = await searchRoute.POST(
      req('/api/routes/optimal-stops', { method: 'POST', body: { ...VALID_SEARCH, origin: { label: 'x', lat: 999, lon: -3.7 } } })
    );
    expect(res.status).toBe(422);
  });

  it('rechaza minutos no numéricos y zonas horarias inválidas con 422', async () => {
    const bad1 = { ...VALID_SEARCH, stopWindow: { type: 'TIME_FROM_START', minMinutesFromStart: 'abc', maxMinutesFromStart: 60 } };
    const bad2 = { ...VALID_SEARCH, timeZone: 'Mars/Olympus' };
    expect((await searchRoute.POST(req('/x', { method: 'POST', body: bad1 }))).status).toBe(422);
    expect((await searchRoute.POST(req('/x', { method: 'POST', body: bad2 }))).status).toBe(422);
  });

  it('rechaza JSON mal formado con 400', async () => {
    const r = new NextRequest(new URL('/x', 'http://localhost'), { method: 'POST', body: '{nope', headers: { 'content-type': 'application/json' } });
    expect((await searchRoute.POST(r)).status).toBe(400);
  });
});

describe('RNF-05.2-3 · Propuestas comunitarias y administración', () => {
  it('el cliente no puede fijar id, ratingAvg ni reviewCount (422)', async () => {
    for (const extra of [{ id: 'a3-pk103-saelices' }, { ratingAvg: 5 }, { reviewCount: 999999 }]) {
      const res = await stopsRoute.POST(req('/api/stops', { method: 'POST', body: { ...VALID_STOP, ...extra } }));
      expect(res.status).toBe(422);
    }
  });

  it('rechaza nombres de más de 120 caracteres', async () => {
    const res = await stopsRoute.POST(req('/api/stops', { method: 'POST', body: { ...VALID_STOP, name: 'A'.repeat(5000) } }));
    expect(res.status).toBe(422);
  });

  it('una propuesta válida queda pendiente (202) y solo un admin puede listarla y aprobarla', async () => {
    const created = await stopsRoute.POST(req('/api/stops', { method: 'POST', body: VALID_STOP }));
    expect(created.status).toBe(202);
    const { stop } = await created.json();
    expect(stop.dataQuality).toBe('COMMUNITY_PENDING');

    expect((await stopsRoute.GET(req('/api/stops'))).status).toBe(401);
    expect((await stopsRoute.GET(req('/api/stops', { headers: { authorization: 'Bearer wrong' } }))).status).toBe(401);

    const auth = { authorization: 'Bearer test-admin-token-0123456789abcdef' };
    const list = await stopsRoute.GET(req('/api/stops', { headers: auth }));
    expect(list.status).toBe(200);
    expect((await list.json()).pending.map((s: { id: string }) => s.id)).toContain(stop.id);

    const ctx = { params: Promise.resolve({ id: stop.id }) };
    expect((await approveRoute.POST(req(`/api/stops/${stop.id}/approve`, { method: 'POST' }), ctx)).status).toBe(401);
    expect((await approveRoute.POST(req(`/api/stops/${stop.id}/approve`, { method: 'POST', headers: auth }), ctx)).status).toBe(200);
  });
});

describe('RNF-05.4 · Rate limiting', () => {
  it('devuelve 429 con Retry-After a partir de la 6.ª propuesta en una hora desde la misma IP', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await stopsRoute.POST(req('/api/stops', { method: 'POST', body: VALID_STOP }))).status).toBe(202);
    }
    const blocked = await stopsRoute.POST(req('/api/stops', { method: 'POST', body: VALID_STOP }));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

describe('Fase 6 · Corredor AP-7, Moderación DELETE y Persistencia Cloud-Ready (RF-07, RF-09, RNF-09)', () => {
  it('RF-07: el corredor AP-7 (Barcelona -> Valencia) devuelve paradas óptimas curadas sobre geometría real', async () => {
    const res = await searchRoute.POST(
      req('/api/routes/optimal-stops', {
        method: 'POST',
        body: {
          mode: 'PLANNING',
          origin: { label: 'Barcelona', lat: 41.3874, lon: 2.1686 },
          destination: { label: 'Valencia', lat: 39.4699, lon: -0.3763 },
          departureTimeIso: '2026-11-10T11:30:00.000Z',
          timeZone: 'Europe/Madrid',
          stopWindow: { type: 'TIME_FROM_START', minMinutesFromStart: 50, maxMinutesFromStart: 160 },
        },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.routeSummary.precision).toBe('HIGH');
    expect(body.optimalStops.length).toBeGreaterThan(0);
    expect(body.optimalStops[0].highwayCode).toBe('AP-7');
  });

  it('RF-09: un administrador puede rechazar y eliminar una propuesta pendiente (DELETE /api/stops/[id])', async () => {
    const created = await stopsRoute.POST(req('/api/stops', { method: 'POST', body: VALID_STOP }));
    expect(created.status).toBe(202);
    const { stop } = await created.json();

    const ctx = { params: Promise.resolve({ id: stop.id }) };
    expect((await deleteStopRoute.DELETE(req(`/api/stops/${stop.id}`, { method: 'DELETE' }), ctx)).status).toBe(401);

    const auth = { authorization: 'Bearer test-admin-token-0123456789abcdef' };
    const delRes = await deleteStopRoute.DELETE(req(`/api/stops/${stop.id}`, { method: 'DELETE', headers: auth }), ctx);
    expect(delRes.status).toBe(200);

    const listAfter = await (await stopsRoute.GET(req('/api/stops', { headers: auth }))).json();
    expect(listAfter.pending.map((s: { id: string }) => s.id)).not.toContain(stop.id);
  });

  it('RNF-09: createStopRepositoryFromEnv conmuta entre FileStopRepository y SupabaseStopRepository según variables de entorno', () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(createStopRepositoryFromEnv()).toBeInstanceOf(FileStopRepository);

    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-secret-key';
    expect(createStopRepositoryFromEnv()).toBeInstanceOf(SupabaseStopRepository);

    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });
});
