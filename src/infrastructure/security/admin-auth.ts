import crypto from 'node:crypto';
import { NextRequest } from 'next/server';

export type AdminAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string };

/**
 * RNF-05.3: Verificación de token de administrador en tiempo constante (`timingSafeEqual`).
 * Si `ADMIN_API_TOKEN` no está configurado en el entorno, la administración queda deshabilitada (503).
 */
export function verifyAdminBearerToken(req: NextRequest): AdminAuthResult {
  const expectedToken = process.env.ADMIN_API_TOKEN?.trim();
  if (!expectedToken || expectedToken.length < 16) {
    return {
      ok: false,
      status: 503,
      error:
        'La administración está deshabilitada: configure ADMIN_API_TOKEN (mínimo 16 caracteres).',
    };
  }

  const authHeader = req.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  if (!match) {
    return {
      ok: false,
      status: 401,
      error: 'Cabecera Authorization Bearer requerida.',
    };
  }

  const provided = match[1].trim();
  const bufExpected = Buffer.from(expectedToken, 'utf-8');
  const bufProvided = Buffer.from(provided, 'utf-8');

  if (bufExpected.length !== bufProvided.length) {
    return { ok: false, status: 401, error: 'Credenciales inválidas.' };
  }

  const isEqual = crypto.timingSafeEqual(bufExpected, bufProvided);
  if (!isEqual) {
    return { ok: false, status: 401, error: 'Credenciales inválidas.' };
  }

  return { ok: true };
}
