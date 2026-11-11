import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/infrastructure/container';
import { extractClientIp } from '@/infrastructure/security/rate-limiter';

export interface GeocodePlace {
  label: string;
  lat: number;
  lon: number;
  corridorHint?: string;
}

const POPULAR_SPANISH_LOCATIONS: GeocodePlace[] = [
  { label: 'Madrid', lat: 40.4168, lon: -3.7038, corridorHint: 'Centro' },
  { label: 'Valencia', lat: 39.4699, lon: -0.3763, corridorHint: 'A-3' },
  { label: 'Barcelona', lat: 41.3874, lon: 2.1686, corridorHint: 'A-2 / AP-7' },
  { label: 'Zaragoza', lat: 41.6488, lon: -0.8891, corridorHint: 'A-2' },
  { label: 'Burgos', lat: 42.344, lon: -3.6969, corridorHint: 'A-1' },
  { label: 'Bilbao', lat: 43.263, lon: -2.935, corridorHint: 'A-1 / AP-68' },
  { label: 'San Sebastián / Donostia', lat: 43.3183, lon: -1.9812, corridorHint: 'A-1' },
  { label: 'Sevilla', lat: 37.3891, lon: -5.9845, corridorHint: 'A-4' },
  { label: 'Córdoba', lat: 37.8882, lon: -4.7794, corridorHint: 'A-4' },
  { label: 'Málaga', lat: 36.7213, lon: -4.4214, corridorHint: 'A-4 / A-45' },
  { label: 'Granada', lat: 37.1773, lon: -3.5986, corridorHint: 'A-4 / A-44' },
  { label: 'A Coruña', lat: 43.3623, lon: -8.4115, corridorHint: 'A-6' },
  { label: 'Lugo', lat: 43.0097, lon: -7.5568, corridorHint: 'A-6' },
  { label: 'Valladolid', lat: 41.6523, lon: -4.7245, corridorHint: 'A-6 / A-62' },
  { label: 'Badajoz', lat: 38.8794, lon: -6.9707, corridorHint: 'A-5' },
  { label: 'Mérida', lat: 38.9161, lon: -6.3437, corridorHint: 'A-5 / A-66' },
  { label: 'Tarancón (A-3 PK 80)', lat: 40.0085, lon: -3.0072, corridorHint: 'A-3' },
  { label: 'Aranda de Duero (A-1 PK 153)', lat: 41.6704, lon: -3.6892, corridorHint: 'A-1' },
  { label: 'Guadalajara (A-2 PK 60)', lat: 40.6333, lon: -3.1667, corridorHint: 'A-2' },
  { label: 'Manzanares (A-4 PK 175)', lat: 39.001, lon: -3.372, corridorHint: 'A-4' },
  { label: 'Tordesillas (A-6 PK 184)', lat: 41.5008, lon: -5.001, corridorHint: 'A-6' },
];

const geocodeCache = new Map<string, GeocodePlace[]>();
let lastNominatimCallMs = 0;

export async function GET(req: NextRequest) {
  const { rateLimiter } = getContainer();
  const ip = extractClientIp(req);
  const rl = rateLimiter.check(`geocode:${ip}`, 20, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Demasiadas consultas de geocodificación.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rl.retryAfterSeconds) },
      }
    );
  }

  const q = (req.nextUrl.searchParams.get('q') || '')
    .trim()
    .slice(0, 80)
    .toLowerCase();

  if (!q) {
    return NextResponse.json({
      results: POPULAR_SPANISH_LOCATIONS.slice(0, 12),
    });
  }

  const cached = geocodeCache.get(q);
  if (cached) {
    return NextResponse.json({ results: cached });
  }

  const localMatches = POPULAR_SPANISH_LOCATIONS.filter(
    (loc) =>
      loc.label.toLowerCase().includes(q) ||
      (loc.corridorHint && loc.corridorHint.toLowerCase().includes(q))
  );

  if (localMatches.length >= 2) {
    geocodeCache.set(q, localMatches);
    return NextResponse.json({ results: localMatches });
  }

  // RNF-07.3: Respeto estricto de la política de Nominatim (máx. 1 req/s + User-Agent con contacto)
  const now = Date.now();
  const nominatimBase =
    process.env.NOMINATIM_BASE_URL ?? 'https://nominatim.openstreetmap.org';
  const contactEmail =
    process.env.NOMINATIM_CONTACT_EMAIL ?? 'opensource-optistop@example.org';

  if (
    nominatimBase !== 'disabled' &&
    now - lastNominatimCallMs >= 1050 &&
    q.length >= 3
  ) {
    lastNominatimCallMs = now;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1800);
      const res = await fetch(
        `${nominatimBase}/search?format=json&countrycodes=es&limit=5&q=${encodeURIComponent(
          q
        )}`,
        {
          signal: controller.signal,
          headers: {
            'User-Agent': `OptiStopCarreteras/1.1 (${contactEmail})`,
          },
        }
      );
      clearTimeout(timer);

      if (res.ok) {
        const data = await res.json();
        const nominatimResults: GeocodePlace[] = (data ?? [])
          .map((item: { display_name?: string; lat?: string; lon?: string }) => ({
            label: String(item.display_name || q).split(',')[0],
            lat: Number(item.lat),
            lon: Number(item.lon),
          }))
          .filter(
            (p: GeocodePlace) =>
              Number.isFinite(p.lat) &&
              Number.isFinite(p.lon) &&
              p.lat >= 27 &&
              p.lat <= 44.5 &&
              p.lon >= -18.5 &&
              p.lon <= 4.5
          );

        const combined = [...localMatches, ...nominatimResults].slice(0, 6);
        geocodeCache.set(q, combined);
        return NextResponse.json({ results: combined });
      }
    } catch {
      // Continúa con las coincidencias locales
    }
  }

  return NextResponse.json({ results: localMatches });
}
