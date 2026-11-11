'use client';

import React, { useCallback, useState } from 'react';
import Link from 'next/link';
import { RoadStopEntity } from '@/domain/models/types';
import {
  ArrowLeft,
  CheckCircle2,
  Trash2,
  ShieldCheck,
  RefreshCw,
  KeyRound,
  MapPin,
} from 'lucide-react';

interface AdminStopsPayload {
  pendingCount: number;
  approvedCount: number;
  pending: RoadStopEntity[];
  approved: RoadStopEntity[];
}

export default function AdminModerationPage() {
  const [token, setToken] = useState('');
  const [data, setData] = useState<AdminStopsPayload | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [highwayFilter, setHighwayFilter] = useState<string>('ALL');

  const fetchStops = useCallback(
    async (overrideToken?: string) => {
      const activeToken = (overrideToken ?? token).trim();
      if (!activeToken) {
        setErrorMsg('Introduce el token de administración (ADMIN_API_TOKEN).');
        return;
      }

      setIsLoading(true);
      setErrorMsg(null);
      setStatusMsg(null);

      try {
        const res = await fetch('/api/stops', {
          headers: {
            Authorization: `Bearer ${activeToken}`,
          },
        });
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json?.error || `Error HTTP ${res.status}`);
        }
        setData(json as AdminStopsPayload);
      } catch (err) {
        setErrorMsg(
          err instanceof Error
            ? err.message
            : 'No se pudo conectar con el servidor de moderación.'
        );
      } finally {
        setIsLoading(false);
      }
    },
    [token]
  );

  async function handleApprove(stopId: string) {
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await fetch(`/api/stops/${encodeURIComponent(stopId)}/approve`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token.trim()}`,
        },
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error || `Error HTTP ${res.status}`);
      }
      setStatusMsg(`Parada "${json.stop.name}" aprobada e incorporada al ranking.`);
      await fetchStops();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al aprobar parada.');
    }
  }

  async function handleReject(stopId: string, name: string) {
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await fetch(`/api/stops/${encodeURIComponent(stopId)}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token.trim()}`,
        },
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error || `Error HTTP ${res.status}`);
      }
      setStatusMsg(`Propuesta "${name}" descartada.`);
      await fetchStops();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al descartar parada.');
    }
  }

  const highways = Array.from(
    new Set((data?.approved ?? []).map((s) => s.highwayCode))
  ).sort();

  const filteredApproved = (data?.approved ?? []).filter(
    (s) => highwayFilter === 'ALL' || s.highwayCode === highwayFilter
  );

  return (
    <div className="min-h-dvh bg-[#f4f1ea] text-[#181816] px-4 py-8 md:px-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Cabecera */}
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e6e2d8] pb-4">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#fcfbf8] border border-[#e6e2d8] text-xs font-bold text-[#181816] hover:border-[#b8b2a3]"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Volver al mapa
            </Link>
            <div>
              <h1 className="text-lg font-extrabold tracking-tight flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-[#165b40]" />
                Panel de Moderación y Catálogo
              </h1>
              <p className="text-xs text-[#5c5a54]">
                Revisa propuestas comunitarias (`COMMUNITY_PENDING`) antes de publicarlas en el motor OptiStop.
              </p>
            </div>
          </div>
        </header>

        {/* Autenticación Admin */}
        <section className="bg-[#fcfbf8] rounded-2xl border border-[#e6e2d8] p-4 shadow-2xs">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              fetchStops();
            }}
            className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3"
          >
            <div className="flex-1">
              <label
                htmlFor="admin-token-input"
                className="block text-xs font-bold text-[#181816] mb-1"
              >
                Token de Administración (`ADMIN_API_TOKEN`)
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-[#5c5a54] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="admin-token-input"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Introduce tu ADMIN_API_TOKEN..."
                  className="w-full pl-9 pr-3 py-2 rounded-xl border border-[#e6e2d8] bg-white text-xs font-medium focus:outline-none focus:border-[#165b40]"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-[#165b40] hover:bg-[#114a33] text-white text-xs font-bold cursor-pointer disabled:opacity-50"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`}
              />
              {isLoading ? 'Cargando...' : 'Cargar cola de moderación'}
            </button>
          </form>

          {errorMsg && (
            <div
              role="alert"
              className="mt-3 rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-xs font-medium text-red-900"
            >
              {errorMsg}
            </div>
          )}

          {statusMsg && (
            <div
              role="status"
              className="mt-3 rounded-xl bg-[#165b40]/10 border border-[#165b40]/30 px-3.5 py-2.5 text-xs font-semibold text-[#165b40]"
            >
              {statusMsg}
            </div>
          )}
        </section>

        {data && (
          <>
            {/* Cola de propuestas pendientes */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-extrabold text-[#181816]">
                  Propuestas pendientes de revisión ({data.pendingCount})
                </h2>
              </div>

              {data.pending.length === 0 ? (
                <div className="bg-[#fcfbf8] rounded-2xl border border-[#e6e2d8] p-6 text-center text-xs text-[#5c5a54]">
                  No hay propuestas pendientes de moderación en este momento.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {data.pending.map((stop) => (
                    <div
                      key={stop.id}
                      className="bg-[#fcfbf8] rounded-2xl border border-[#e6e2d8] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 text-[11px] font-bold">
                            {stop.highwayCode} · KM {stop.kmMarker}
                          </span>
                          <h3 className="text-sm font-bold text-[#181816]">
                            {stop.name}
                          </h3>
                        </div>
                        <p className="text-xs text-[#5c5a54]">
                          {stop.locality} — {stop.specialty}
                        </p>
                        <p className="text-[11px] text-[#5c5a54] flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {stop.coordinates.lat}, {stop.coordinates.lon} · Acceso:{' '}
                          {stop.accessType}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleApprove(stop.id)}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#165b40] hover:bg-[#114a33] text-white text-xs font-bold cursor-pointer"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Aprobar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleReject(stop.id, stop.name)}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-800 border border-red-200 text-xs font-bold cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Descartar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Catálogo activo por corredor */}
            <section className="space-y-3 pt-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-extrabold text-[#181816]">
                  Catálogo activo en carretera ({filteredApproved.length} de{' '}
                  {data.approvedCount})
                </h2>

                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setHighwayFilter('ALL')}
                    className={`px-2.5 py-1 rounded-full text-xs font-bold border cursor-pointer ${
                      highwayFilter === 'ALL'
                        ? 'bg-[#181816] text-white border-[#181816]'
                        : 'bg-[#fcfbf8] text-[#5c5a54] border-[#e6e2d8]'
                    }`}
                  >
                    Todas
                  </button>
                  {highways.map((hw) => (
                    <button
                      key={hw}
                      type="button"
                      onClick={() => setHighwayFilter(hw)}
                      className={`px-2.5 py-1 rounded-full text-xs font-bold border cursor-pointer ${
                        highwayFilter === hw
                          ? 'bg-[#181816] text-white border-[#181816]'
                          : 'bg-[#fcfbf8] text-[#5c5a54] border-[#e6e2d8]'
                      }`}
                    >
                      {hw}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {filteredApproved.map((stop) => (
                  <div
                    key={stop.id}
                    className="bg-[#fcfbf8] rounded-xl border border-[#e6e2d8] p-3.5 space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="px-2 py-0.5 rounded-md bg-[#f4f1ea] text-[#181816] text-[11px] font-bold">
                        {stop.highwayCode} · KM {stop.kmMarker}
                      </span>
                      <span className="text-[11px] font-semibold text-[#5c5a54]">
                        {stop.dataQuality}
                      </span>
                    </div>
                    <h3 className="text-xs font-bold text-[#181816]">
                      {stop.name}
                    </h3>
                    <p className="text-[11px] text-[#5c5a54] line-clamp-1">
                      {stop.specialty}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
