import { NextRequest } from 'next/server';

export interface RateLimitCheckResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * RNF-05.4: Limitador de peticiones en ventana deslizante por clave (IP + acción).
 */
export class SlidingWindowRateLimiter {
  private readonly hitsByKey = new Map<string, number[]>();
  private readonly nowFn: () => number;

  constructor(nowFn: () => number = () => Date.now()) {
    this.nowFn = nowFn;
  }

  public check(
    key: string,
    maxRequests: number,
    windowMs: number
  ): RateLimitCheckResult {
    const now = this.nowFn();
    const cutoff = now - windowMs;
    const prev = this.hitsByKey.get(key) ?? [];
    const active = prev.filter((ts) => ts > cutoff);

    if (active.length >= maxRequests) {
      const oldestInWindow = active[0];
      const retryAfterMs = Math.max(1000, oldestInWindow + windowMs - now);
      this.hitsByKey.set(key, active);
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
      };
    }

    active.push(now);
    this.hitsByKey.set(key, active);
    return {
      allowed: true,
      remaining: Math.max(0, maxRequests - active.length),
      retryAfterSeconds: 0,
    };
  }

  public clear(): void {
    this.hitsByKey.clear();
  }
}

export function extractClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;
  return '127.0.0.1';
}
