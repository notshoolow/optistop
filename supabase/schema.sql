-- Esquema SQL para Supabase / PostgreSQL (RNF-09 — Persistencia Cloud-Ready)
-- Compatible con el tier gratuito de Supabase / Neon

CREATE TABLE IF NOT EXISTS public.road_stops (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'APPROVED' CHECK (status IN ('APPROVED', 'PENDING_REVIEW')),
  highway_code TEXT NOT NULL,
  km_marker INTEGER NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_road_stops_status_coords
  ON public.road_stops (status, lat, lon);

CREATE TABLE IF NOT EXISTS public.corridor_cache (
  corridor_hash TEXT PRIMARY KEY,
  cached_at_ms BIGINT NOT NULL,
  stop_ids JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS public.monthly_quotas (
  month_key TEXT PRIMARY KEY,
  used_calls INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
