/**
 * Genera polilíneas pregrabadas de los corredores principales (RNF-04.4).
 * Se ejecuta UNA vez en desarrollo:  node scripts/build-corridor-fixtures.mjs
 * Fuente: OSRM (datos © OpenStreetMap contributors, ODbL). Respeta la política del
 * servidor demo: 6 peticiones secuenciales con pausa de 1,5 s.
 */
import { writeFile, mkdir } from 'node:fs/promises';

const OSRM = process.env.OSRM_BASE_URL || 'https://router.project-osrm.org';
const PLACES = {
  madrid: [40.4168, -3.7038],
  valencia: [39.4699, -0.3763],
  burgos: [42.344, -3.6969],
  zaragoza: [41.6488, -0.8891],
  sevilla: [37.3891, -5.9845],
  coruna: [43.3623, -8.4115],
  badajoz: [38.8794, -6.9707],
};
const CORRIDORS = [
  ['a3', 'madrid', 'valencia'],
  ['a1', 'madrid', 'burgos'],
  ['a2', 'madrid', 'zaragoza'],
  ['a4', 'madrid', 'sevilla'],
  ['a6', 'madrid', 'coruna'],
  ['a5', 'madrid', 'badajoz'],
];
const STEP_KM = 2;

const toRad = (d) => (d * Math.PI) / 180;
function hav([lat1, lon1], [lat2, lon2]) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

await mkdir('data/corridors', { recursive: true });

for (const [id, from, to] of CORRIDORS) {
  const [aLat, aLon] = PLACES[from];
  const [bLat, bLon] = PLACES[to];
  const url = `${OSRM}/route/v1/driving/${aLon},${aLat};${bLon},${bLat}?overview=full&geometries=geojson`;
  const json = await (await fetch(url, { headers: { 'User-Agent': 'OptiStop-fixtures/1.0' } })).json();
  const route = json.routes[0];
  const pts = route.geometry.coordinates.map(([lon, lat]) => [lat, lon]);

  // Submuestreo por distancia (~2 km) conservando el primer y el último punto
  const sampled = [pts[0]];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    acc += hav(pts[i - 1], pts[i]);
    if (acc >= STEP_KM) { sampled.push(pts[i]); acc = 0; }
  }
  sampled.push(pts[pts.length - 1]);

  const fixture = {
    id,
    from: { label: from, lat: aLat, lon: aLon },
    to: { label: to, lat: bLat, lon: bLon },
    distanceKm: Math.round(route.distance / 1000),
    durationMin: Math.round(route.duration / 60),
    attribution: '© OpenStreetMap contributors (ODbL) — generado con OSRM',
    generatedAt: new Date().toISOString(),
    coords: sampled.map(([lat, lon]) => [Number(lat.toFixed(5)), Number(lon.toFixed(5))]),
  };
  await writeFile(`data/corridors/${id}.json`, JSON.stringify(fixture));
  console.log(`${id}: ${fixture.distanceKm} km, ${fixture.durationMin} min, ${fixture.coords.length} pts`);
  await new Promise((r) => setTimeout(r, 1500));
}
