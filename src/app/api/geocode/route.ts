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
  // Capitales y grandes ciudades
  { label: 'Madrid', lat: 40.4168, lon: -3.7038, corridorHint: 'Centro' },
  { label: 'Barcelona', lat: 41.3874, lon: 2.1686, corridorHint: 'A-2 / AP-7' },
  { label: 'Valencia', lat: 39.4699, lon: -0.3763, corridorHint: 'A-3 / AP-7' },
  { label: 'Sevilla', lat: 37.3891, lon: -5.9845, corridorHint: 'A-4 / A-66' },
  { label: 'Zaragoza', lat: 41.6488, lon: -0.8891, corridorHint: 'A-2 / A-23' },
  { label: 'Málaga', lat: 36.7213, lon: -4.4214, corridorHint: 'A-4 / A-45' },
  { label: 'Murcia', lat: 37.9922, lon: -1.1307, corridorHint: 'A-30 / A-7' },
  { label: 'Palma de Mallorca', lat: 39.5696, lon: 2.6502 },
  { label: 'Las Palmas de Gran Canaria', lat: 28.1235, lon: -15.4363 },
  { label: 'Bilbao', lat: 43.263, lon: -2.935, corridorHint: 'A-1 / AP-68' },
  { label: 'Alicante', lat: 38.3452, lon: -0.4815, corridorHint: 'A-31 / AP-7' },
  { label: 'Córdoba', lat: 37.8882, lon: -4.7794, corridorHint: 'A-4' },
  { label: 'Valladolid', lat: 41.6523, lon: -4.7245, corridorHint: 'A-6 / A-62' },
  { label: 'Vigo', lat: 42.2406, lon: -8.7207, corridorHint: 'A-52 / AP-9' },
  { label: 'Gijón', lat: 43.5357, lon: -5.6615, corridorHint: 'A-66 / A-8' },
  { label: 'L\'Hospitalet de Llobregat', lat: 41.3597, lon: 2.0997 },
  { label: 'A Coruña', lat: 43.3623, lon: -8.4115, corridorHint: 'A-6' },
  { label: 'Vitoria-Gasteiz', lat: 42.8469, lon: -2.6716, corridorHint: 'A-1' },
  { label: 'Granada', lat: 37.1773, lon: -3.5986, corridorHint: 'A-4 / A-44' },
  { label: 'Elche', lat: 38.2669, lon: -0.6983, corridorHint: 'A-7' },
  { label: 'Oviedo', lat: 43.3614, lon: -5.8494, corridorHint: 'A-66' },
  { label: 'Badalona', lat: 41.4500, lon: 2.2474 },
  { label: 'Cartagena', lat: 37.6257, lon: -0.9966, corridorHint: 'A-30' },
  { label: 'Terrassa', lat: 41.5632, lon: 2.0125 },
  { label: 'Jerez de la Frontera', lat: 36.6850, lon: -6.1261, corridorHint: 'A-4' },
  { label: 'Sabadell', lat: 41.5433, lon: 2.1094 },
  { label: 'Santa Cruz de Tenerife', lat: 28.4636, lon: -16.2518 },
  { label: 'Móstoles', lat: 40.3232, lon: -3.8649, corridorHint: 'A-5' },
  { label: 'Alcalá de Henares', lat: 40.4819, lon: -3.3643, corridorHint: 'A-2' },
  { label: 'Fuenlabrada', lat: 40.2842, lon: -3.7942, corridorHint: 'A-42' },
  { label: 'Pamplona', lat: 42.8125, lon: -1.6458, corridorHint: 'A-15 / AP-15' },
  { label: 'Almería', lat: 36.8381, lon: -2.4597, corridorHint: 'A-7 / A-92' },
  { label: 'Leganés', lat: 40.3280, lon: -3.7635, corridorHint: 'A-42' },
  { label: 'San Sebastián / Donostia', lat: 43.3183, lon: -1.9812, corridorHint: 'A-1 / AP-8' },
  { label: 'Santander', lat: 43.4623, lon: -3.8099, corridorHint: 'A-67 / A-8' },
  { label: 'Castellón de la Plana', lat: 39.9864, lon: -0.0513, corridorHint: 'AP-7' },
  { label: 'Burgos', lat: 42.3440, lon: -3.6969, corridorHint: 'A-1' },
  { label: 'Albacete', lat: 38.9943, lon: -1.8585, corridorHint: 'A-31' },
  { label: 'Getafe', lat: 40.3083, lon: -3.7327, corridorHint: 'A-4' },
  { label: 'Alcorcón', lat: 40.3458, lon: -3.8249, corridorHint: 'A-5' },
  { label: 'Salamanca', lat: 40.9701, lon: -5.6635, corridorHint: 'A-50 / A-62 / A-66' },
  { label: 'Logroño', lat: 42.4650, lon: -2.4456, corridorHint: 'A-12 / AP-68' },
  { label: 'Badajoz', lat: 38.8794, lon: -6.9707, corridorHint: 'A-5' },
  { label: 'Huelva', lat: 37.2614, lon: -6.9447, corridorHint: 'A-49' },
  { label: 'Marbella', lat: 36.5101, lon: -4.8824, corridorHint: 'AP-7' },
  { label: 'León', lat: 42.5987, lon: -5.5671, corridorHint: 'A-66 / A-231' },
  { label: 'Tarragona', lat: 41.1189, lon: 1.2445, corridorHint: 'AP-7' },
  { label: 'Cádiz', lat: 36.5271, lon: -6.2886, corridorHint: 'A-4' },
  { label: 'Lleida', lat: 41.6176, lon: 0.6200, corridorHint: 'A-2 / AP-2' },
  { label: 'Jaén', lat: 37.7796, lon: -3.7849, corridorHint: 'A-44' },
  { label: 'Ourense', lat: 42.3358, lon: -7.8639, corridorHint: 'A-52' },
  { label: 'Lugo', lat: 43.0097, lon: -7.5568, corridorHint: 'A-6' },
  { label: 'Girona', lat: 41.9794, lon: 2.8214, corridorHint: 'AP-7' },
  { label: 'Cáceres', lat: 39.4753, lon: -6.3723, corridorHint: 'A-66 / A-58' },
  { label: 'Santiago de Compostela', lat: 42.8782, lon: -8.5448, corridorHint: 'AP-9 / A-54' },
  { label: 'Toledo', lat: 39.8628, lon: -4.0273, corridorHint: 'A-42' },
  { label: 'Pontevedra', lat: 42.4336, lon: -8.6480, corridorHint: 'AP-9' },
  { label: 'Palencia', lat: 42.0095, lon: -4.5288, corridorHint: 'A-67' },
  { label: 'Ciudad Real', lat: 38.9848, lon: -3.9274, corridorHint: 'A-43' },
  { label: 'Zamora', lat: 41.5063, lon: -5.7446, corridorHint: 'A-11 / A-66' },
  { label: 'Ávila', lat: 40.6567, lon: -4.6812, corridorHint: 'A-51' },
  { label: 'Cuenca', lat: 40.0704, lon: -2.1374, corridorHint: 'A-40' },
  { label: 'Huesca', lat: 42.1362, lon: -0.4087, corridorHint: 'A-23' },
  { label: 'Segovia', lat: 40.9429, lon: -4.1088, corridorHint: 'AP-61 / A-601' },
  { label: 'Soria', lat: 41.7666, lon: -2.4688, corridorHint: 'A-15' },
  { label: 'Teruel', lat: 40.3456, lon: -1.1072, corridorHint: 'A-23' },
  { label: 'Mérida', lat: 38.9161, lon: -6.3437, corridorHint: 'A-5 / A-66' },
  { label: 'Torrelavega', lat: 43.3494, lon: -4.0479, corridorHint: 'A-8 / A-67' },
  { label: 'Benidorm', lat: 38.5411, lon: -0.1225, corridorHint: 'AP-7' },
  { label: 'Gandía', lat: 38.9671, lon: -0.1804, corridorHint: 'AP-7' },
  { label: 'Ponferrada', lat: 42.5466, lon: -6.5909, corridorHint: 'A-6' },
  { label: 'Talavera de la Reina', lat: 39.9635, lon: -4.8308, corridorHint: 'A-5' },
  { label: 'Aranda de Duero', lat: 41.6704, lon: -3.6892, corridorHint: 'A-1' },
  { label: 'Tarancón', lat: 40.0085, lon: -3.0072, corridorHint: 'A-3' },
  { label: 'Manzanares', lat: 39.0010, lon: -3.3720, corridorHint: 'A-4' },
  { label: 'Tordesillas', lat: 41.5008, lon: -5.0010, corridorHint: 'A-6' },
  { label: 'Benavente', lat: 42.0025, lon: -5.6712, corridorHint: 'A-6 / A-66' },
  { label: 'Guadalajara', lat: 40.6333, lon: -3.1667, corridorHint: 'A-2' },
  { label: 'Algeciras', lat: 36.1408, lon: -5.4562, corridorHint: 'A-7' },
  { label: 'Figueres', lat: 42.2665, lon: 2.9616, corridorHint: 'AP-7' },
  { label: 'Plasencia', lat: 40.0307, lon: -6.0894, corridorHint: 'A-66' },
  { label: 'Trujillo', lat: 39.4612, lon: -5.8815, corridorHint: 'A-5 / A-58' },
  { label: 'Bailén', lat: 38.0967, lon: -3.7761, corridorHint: 'A-4' },
  { label: 'Motril', lat: 36.7456, lon: -3.5178, corridorHint: 'A-7 / A-44' },
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
    process.env.NOMINATIM_CONTACT_EMAIL ?? 'dev@optistop.es';

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
            'User-Agent': `OptiStopApp/1.1 (https://optistop.es; ${contactEmail})`,
            'Accept-Language': 'es-ES,es;q=0.9',
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
