#!/usr/bin/env node
/**
 * Script CLI de Ingesta de Corredores y Paradas (RF-07)
 * Uso:
 *   node scripts/seed-corridor.mjs --id ap7 --from "barcelona,41.3874,2.1686" --to "valencia,39.4699,-0.3763"
 */
import fs from 'node:fs';
import path from 'node:path';

function parseArg(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1]) {
    return process.argv[idx + 1];
  }
  return fallback;
}

function parsePlace(raw) {
  const [label, latStr, lonStr] = raw.split(',');
  return {
    label: label.trim().toLowerCase(),
    lat: Number(latStr),
    lon: Number(lonStr),
  };
}

async function main() {
  const id = parseArg('--id', 'ap7');
  const from = parsePlace(parseArg('--from', 'barcelona,41.3874,2.1686'));
  const to = parsePlace(parseArg('--to', 'valencia,39.4699,-0.3763'));

  const url = `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson`;
  console.log(`[seed-corridor] Consultando geometría OSRM para ${id.toUpperCase()} (${from.label} -> ${to.label})...`);

  const res = await fetch(url, {
    headers: { 'User-Agent': 'OptiStop-CLI/1.1' },
  });
  if (!res.ok) {
    throw new Error(`OSRM respondió HTTP ${res.status}`);
  }

  const data = await res.json();
  const route = data?.routes?.[0];
  if (!route?.geometry?.coordinates?.length) {
    throw new Error('OSRM no devolvió coordenadas de ruta');
  }

  const raw = route.geometry.coordinates;
  const step = Math.max(1, Math.floor(raw.length / 160));
  const coords = [];
  for (let i = 0; i < raw.length; i += step) {
    coords.push([Number(raw[i][1].toFixed(5)), Number(raw[i][0].toFixed(5))]);
  }
  const last = raw[raw.length - 1];
  const lastPair = [Number(last[1].toFixed(5)), Number(last[0].toFixed(5))];
  if (
    coords.length === 0 ||
    coords[coords.length - 1][0] !== lastPair[0] ||
    coords[coords.length - 1][1] !== lastPair[1]
  ) {
    coords.push(lastPair);
  }

  const out = {
    id,
    from,
    to,
    distanceKm: Math.round(route.distance / 1000),
    durationMin: Math.round(route.duration / 60),
    attribution: '© OpenStreetMap contributors (ODbL) — generado con OSRM',
    generatedAt: new Date().toISOString(),
    coords,
  };

  const outPath = path.join(process.cwd(), 'data', 'corridors', `${id}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out), 'utf-8');
  console.log(
    `[seed-corridor] Guardado ${outPath}: ${coords.length} vértices, ${out.distanceKm} km, ${out.durationMin} min.`
  );
}

main().catch((err) => {
  console.error('[seed-corridor] Error:', err);
  process.exit(1);
});
