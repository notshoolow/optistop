'use client';

import React, { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  EvaluatedOptimalStop,
  RouteVertex,
} from '@/domain/models/types';

interface RouteMapProps {
  fullPolyline: RouteVertex[];
  windowPolyline: RouteVertex[];
  optimalStops: EvaluatedOptimalStop[];
  selectedStopId: string | null;
  onSelectStop: (stopId: string) => void;
  originLabel: string;
  destinationLabel: string;
}

function getAnchorZIndex(rank: number, isSelected: boolean): string {
  return isSelected ? '30' : rank === 1 ? '20' : '10';
}

function getPillClassName(rank: number, isSelected: boolean): string {
  const stateClass = isSelected
    ? 'is-selected'
    : rank === 1
      ? 'is-top1'
      : 'is-default';
  return `optistop-marker-pill focus:outline-none ${stateClass}`;
}

const FALLBACK_RASTER_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    'osm-raster': {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [
    {
      id: 'osm-raster-layer',
      type: 'raster',
      source: 'osm-raster',
      minzoom: 0,
      maxzoom: 19,
    },
  ],
};

export function RouteMap({
  fullPolyline,
  windowPolyline,
  optimalStops,
  selectedStopId,
  onSelectStop,
  originLabel,
  destinationLabel,
}: RouteMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const isStyleReadyRef = useRef<boolean>(false);
  const justLoadedRouteRef = useRef<boolean>(false);
  const routeMarkersRef = useRef<maplibregl.Marker[]>([]);
  const stopMarkersRef = useRef<
    Map<
      string,
      {
        marker: maplibregl.Marker;
        anchorEl: HTMLDivElement;
        pillEl: HTMLButtonElement;
        rank: number;
      }
    >
  >(new Map());
  const onSelectStopRef = useRef(onSelectStop);
  onSelectStopRef.current = onSelectStop;
  const selectedStopIdRef = useRef(selectedStopId);
  selectedStopIdRef.current = selectedStopId;
  const optimalStopsRef = useRef(optimalStops);
  optimalStopsRef.current = optimalStops;

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    // En MapLibre GL v6 el Web Worker está en un módulo separado; lo servimos desde /public
    maplibregl.setWorkerUrl('/maplibre-gl-worker.mjs');

    const container = mapContainerRef.current;
    const map = new maplibregl.Map({
      container,
      style: 'https://tiles.openfreemap.org/styles/bright',
      center: [-3.2, 40.1],
      zoom: 6.2,
    });

    const markStyleReady = () => {
      isStyleReadyRef.current = true;
      map.resize();
    };
    map.on('style.load', markStyleReady);
    map.on('load', markStyleReady);

    // Si el worker de teselas vectoriales falla en un navegador móvil específico, degradación elegante a teselas raster OpenStreetMap
    map.on('error', (e) => {
      const msg = e.error?.message || '';
      if (
        msg.includes('worker') ||
        msg.includes('Worker') ||
        msg.includes('style') ||
        msg.includes('SecurityError') ||
        msg.includes('CSP')
      ) {
        if (!isStyleReadyRef.current) {
          try {
            map.setStyle(FALLBACK_RASTER_STYLE);
          } catch {
            // Silencioso
          }
        }
      }
    });

    const fallbackTimeout = setTimeout(() => {
      if (!isStyleReadyRef.current && mapRef.current) {
        try {
          map.setStyle(FALLBACK_RASTER_STYLE);
        } catch {
          // Silencioso
        }
      }
    }, 4500);

    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    mapRef.current = map;

    // Forzar redimensionamiento en carga inicial para evitar canvas desalineado en móviles
    requestAnimationFrame(() => {
      map.resize();
    });
    const initTimer = setTimeout(() => {
      map.resize();
    }, 300);

    const onWindowResize = () => {
      map.resize();
    };
    window.addEventListener('resize', onWindowResize);
    window.addEventListener('orientationchange', onWindowResize);

    const resizeObserver = new ResizeObserver(() => {
      map.resize();
    });
    resizeObserver.observe(container);

    return () => {
      clearTimeout(fallbackTimeout);
      clearTimeout(initTimer);
      window.removeEventListener('resize', onWindowResize);
      window.removeEventListener('orientationchange', onWindowResize);
      resizeObserver.disconnect();
      map.off('style.load', markStyleReady);
      map.off('load', markStyleReady);
      isStyleReadyRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // 1. Renderizar marcadores HTML de inmediato
    for (const m of routeMarkersRef.current) m.remove();
    routeMarkersRef.current = [];

    for (const entry of stopMarkersRef.current.values()) {
      entry.marker.remove();
    }
    stopMarkersRef.current.clear();

    if (fullPolyline.length >= 2) {
      const startPt = fullPolyline[0];
      const endPt = fullPolyline[fullPolyline.length - 1];

      const origEl = document.createElement('div');
      origEl.className =
        'px-2.5 py-1 rounded-full bg-[#181816]/90 backdrop-blur-xs text-white text-[11px] font-semibold shadow-sm';
      origEl.textContent = originLabel;
      routeMarkersRef.current.push(
        new maplibregl.Marker({ element: origEl })
          .setLngLat([startPt.lon, startPt.lat])
          .addTo(map)
      );

      const destEl = document.createElement('div');
      destEl.className =
        'px-2.5 py-1 rounded-full bg-[#181816]/90 backdrop-blur-xs text-white text-[11px] font-semibold shadow-sm';
      destEl.textContent = destinationLabel;
      routeMarkersRef.current.push(
        new maplibregl.Marker({ element: destEl })
          .setLngLat([endPt.lon, endPt.lat])
          .addTo(map)
      );
    }

    // Marcadores estilo Airbnb/Apple Maps con separación de Ancla WebGL y Píldora Animada
    optimalStops.forEach((stop, index) => {
      const rank = index + 1;
      const isSelected = stop.id === selectedStopIdRef.current;

      const anchorEl = document.createElement('div');
      anchorEl.classList.add('optistop-marker-anchor');
      anchorEl.style.zIndex = getAnchorZIndex(rank, isSelected);

      const pillEl = document.createElement('button');
      pillEl.type = 'button';
      pillEl.className = getPillClassName(rank, isSelected);
      pillEl.setAttribute(
        'aria-label',
        `Parada ${rank}: ${stop.name}, desvío +${stop.routeMetrics.detourTimeMinutes} minutos`
      );
      pillEl.title = `${stop.name} (+${stop.routeMetrics.detourTimeMinutes} min desvío)`;

      const rankSpan = document.createElement('span');
      rankSpan.textContent = `#${rank}`;
      const sepSpan = document.createElement('span');
      sepSpan.className = 'opacity-50';
      sepSpan.textContent = '·';
      const detourSpan = document.createElement('span');
      detourSpan.className = 'font-medium';
      detourSpan.textContent = `+${stop.routeMetrics.detourTimeMinutes}m`;

      pillEl.appendChild(rankSpan);
      pillEl.appendChild(sepSpan);
      pillEl.appendChild(detourSpan);

      pillEl.addEventListener('click', (ev) => {
        ev.stopPropagation();
        onSelectStopRef.current(stop.id);
      });

      anchorEl.appendChild(pillEl);

      const marker = new maplibregl.Marker({
        element: anchorEl,
        anchor: 'bottom',
        offset: [0, -6],
      })
        .setLngLat([stop.coordinates.lon, stop.coordinates.lat])
        .addTo(map);

      stopMarkersRef.current.set(stop.id, {
        marker,
        anchorEl,
        pillEl,
        rank,
      });
    });

    // 2. Renderizar las polilíneas GeoJSON cuando el estilo base esté cargado
    const renderPolylines = () => {
      try {
        const fullCoords = fullPolyline.map((pt) => [pt.lon, pt.lat]);
        const fullGeoJson: GeoJSON.Feature<GeoJSON.LineString> = {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: fullCoords },
        };

        const existingFullSource = map.getSource(
          'full-route'
        ) as maplibregl.GeoJSONSource | undefined;
        if (existingFullSource) {
          existingFullSource.setData(fullGeoJson);
        } else if (fullCoords.length >= 2) {
          map.addSource('full-route', { type: 'geojson', data: fullGeoJson });
          map.addLayer({
            id: 'full-route-line',
            type: 'line',
            source: 'full-route',
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: {
              'line-color': '#78756e',
              'line-width': 4.5,
              'line-opacity': 0.55,
            },
          });
        }

        const windowCoords = windowPolyline.map((pt) => [pt.lon, pt.lat]);
        const windowGeoJson: GeoJSON.Feature<GeoJSON.LineString> = {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: windowCoords },
        };

        const existingWindowSource = map.getSource(
          'window-route'
        ) as maplibregl.GeoJSONSource | undefined;
        if (existingWindowSource) {
          existingWindowSource.setData(windowGeoJson);
        } else if (windowCoords.length >= 2) {
          map.addSource('window-route', {
            type: 'geojson',
            data: windowGeoJson,
          });
          map.addLayer({
            id: 'window-route-glow',
            type: 'line',
            source: 'window-route',
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: {
              'line-color': '#165b40',
              'line-width': 14,
              'line-opacity': 0.22,
            },
          });
          map.addLayer({
            id: 'window-route-line',
            type: 'line',
            source: 'window-route',
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: {
              'line-color': '#165b40',
              'line-width': 6,
              'line-opacity': 0.95,
            },
          });
        }
      } catch {
        // Si el estilo aún está inicializando sus capas internas, se reintentará en 'load'
      }
    };

    if (isStyleReadyRef.current) {
      renderPolylines();
    } else {
      map.once('style.load', renderPolylines);
      map.once('load', renderPolylines);
    }

    if (fullPolyline.length >= 2) {
      justLoadedRouteRef.current = true;
      map.resize();
      const bounds = new maplibregl.LngLatBounds();
      for (const pt of fullPolyline) bounds.extend([pt.lon, pt.lat]);
      for (const st of optimalStops) {
        bounds.extend([st.coordinates.lon, st.coordinates.lat]);
      }
      const isMobile =
        typeof window !== 'undefined' && window.innerWidth < 1024;
      const padding = isMobile
        ? { top: 24, bottom: 44, left: 20, right: 20 }
        : 64;

      map.fitBounds(bounds, {
        padding,
        maxZoom: 10.5,
        duration: 600,
        essential: true,
      });
    }

    return () => {
      map.off('style.load', renderPolylines);
      map.off('load', renderPolylines);
    };
  }, [
    fullPolyline,
    windowPolyline,
    optimalStops,
    originLabel,
    destinationLabel,
  ]);

  useEffect(() => {
    for (const [id, entry] of stopMarkersRef.current.entries()) {
      const isSelected = id === selectedStopId;
      entry.anchorEl.style.zIndex = getAnchorZIndex(entry.rank, isSelected);
      entry.pillEl.className = getPillClassName(entry.rank, isSelected);
    }

    // Si acabamos de cargar una ruta completa, respetamos el encuadre general de fitBounds
    if (justLoadedRouteRef.current) {
      justLoadedRouteRef.current = false;
      return;
    }

    const map = mapRef.current;
    if (!map || !selectedStopId) return;
    const found = optimalStopsRef.current.find((s) => s.id === selectedStopId);
    if (found) {
      // Deslizamiento suave con curva cubic-out sin el rebote brusco de zoom de flyTo
      map.easeTo({
        center: [found.coordinates.lon, found.coordinates.lat],
        zoom: Math.max(map.getZoom(), 8.6),
        duration: 680,
        easing: (t) => 1 - Math.pow(1 - t, 3),
        essential: true,
      });
    }
  }, [selectedStopId]);

  return (
    <div
      role="region"
      aria-label="Mapa interactivo de la ruta y paradas óptimas"
      className="relative w-full h-full min-h-[260px] lg:min-h-[320px] bg-[#eae6dc] overflow-hidden"
    >
      <div
        ref={mapContainerRef}
        className="absolute inset-0 w-full h-full"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          width: '100%',
          height: '100%',
        }}
      />

      {/* Píldora flotante minimalista con el significado visual del tramo */}
      <div className="absolute bottom-4 left-4 bg-[#fcfbf8]/95 backdrop-blur-md px-3.5 py-2 rounded-full shadow-md border border-[#e6e2d8] text-xs flex items-center gap-4 text-[#181816]">
        <span className="flex items-center gap-1.5 font-medium text-[#5c5a54]">
          <span className="w-3.5 h-1 rounded-full bg-[#78756e] inline-block" />
          Ruta
        </span>
        <span className="flex items-center gap-1.5 font-semibold text-[#165b40]">
          <span className="w-4 h-1.5 rounded-full bg-[#165b40] inline-block" />
          Tramo donde parar
        </span>
      </div>
    </div>
  );
}
