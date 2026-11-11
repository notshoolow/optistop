import { PriceLevel } from '../models/types';

export const BAYESIAN_CONFIDENCE_THRESHOLD_M = 50;
export const BAYESIAN_PRIOR_MEAN_C = 3.8;

/**
 * Calcula la nota ponderada Bayesiana:
 * R_bayes = (v * R + m * C) / (v + m)
 * RNF-04.3: Si `ratingAvg === null` o `reviewCount <= 0`, devuelve exactamente el prior `C` (3.8)
 * sin inventar notas ficticias.
 */
export function computeBayesianRating(
  ratingAvg: number | null,
  reviewCount: number,
  m = BAYESIAN_CONFIDENCE_THRESHOLD_M,
  c = BAYESIAN_PRIOR_MEAN_C
): number {
  const safeVotes = Math.max(0, reviewCount);
  if (ratingAvg === null || safeVotes === 0) {
    return Number(c.toFixed(2));
  }
  const safeRating = Math.max(1.0, Math.min(5.0, ratingAvg));
  const bayes = (safeVotes * safeRating + m * c) / (safeVotes + m);
  return Number(bayes.toFixed(2));
}

/**
 * Normaliza R_bayes a una escala de [0, 100]:
 * Q_score = clamp(((R_bayes - 2.5) / (5.0 - 2.5)) * 100, 0, 100)
 */
export function computeQualitySubScore(bayesianRating: number): number {
  const normalized = ((bayesianRating - 2.5) / 2.5) * 100;
  return Number(Math.max(0, Math.min(100, normalized)).toFixed(1));
}

/**
 * Calcula el sub-score de Relación Calidad / Precio y ajuste al centro de la ventana temporal [0, 100].
 * RNF-04.3: Si `priceLevel === null` (desconocido), asigna un valor neutro (68 pts).
 */
export function computeValueAndWindowSubScore(
  bayesianRating: number,
  priceLevel: PriceLevel | null,
  etaMinutesFromStart: number,
  windowMinMinutes: number,
  windowMaxMinutes: number
): number {
  let priceValuePoints = 68;
  if (priceLevel === 1) {
    priceValuePoints = bayesianRating >= 4.0 ? 96 : 82;
  } else if (priceLevel === 2) {
    priceValuePoints = bayesianRating >= 4.2 ? 90 : 78;
  } else if (priceLevel === 3) {
    priceValuePoints = bayesianRating >= 4.5 ? 80 : 62;
  }

  const windowCenter = (windowMinMinutes + windowMaxMinutes) / 2;
  const windowHalfSpan = Math.max(10, (windowMaxMinutes - windowMinMinutes) / 2);
  const distanceFromCenterRatio = Math.min(
    1,
    Math.abs(etaMinutesFromStart - windowCenter) / windowHalfSpan
  );
  const windowCenteringScore = 100 * (1 - 0.35 * distanceFromCenterRatio);

  const combined = 0.65 * priceValuePoints + 0.35 * windowCenteringScore;
  return Number(Math.max(0, Math.min(100, combined)).toFixed(1));
}
