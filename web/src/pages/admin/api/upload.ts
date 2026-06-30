/**
 * POST /api/admin/upload — file upload endpoint (admin only).
 *
 * Accepts multipart/form-data with a single "file" field.
 * Auth: requires context.locals.adminUser (set by middleware for /admin/**).
 * Note: this route lives under /api/admin/upload which IS covered by the
 * middleware /admin/** pattern (pathname starts with '/admin').
 *
 * Validation:
 *   - MIME: image/jpeg, image/png, image/webp only
 *   - Size: <= 5 MB
 *
 * On success: saves to web/public/uploads/<uuid>.<ext>, returns { url: '/uploads/<uuid>.<ext>' }
 * On error: returns { error: 'message' } with appropriate status.
 */
import type { APIRoute } from 'astro';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const prerender = false;

const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

/**
 * Pure validation function — deterministic, no side effects.
 * Exported for unit testing.
 */
export function validateUploadFile(
  mimeType: string,
  sizeBytes: number,
): { ok: true } | { ok: false; error: string; status: number } {
  if (!ALLOWED_MIME[mimeType]) {
    return {
      ok: false,
      error: `Недопустимый тип файла: ${mimeType}. Разрешены: image/jpeg, image/png, image/webp.`,
      status: 415,
    };
  }
  if (sizeBytes > MAX_SIZE_BYTES) {
    return {
      ok: false,
      error: `Файл слишком большой (${sizeBytes} байт). Максимум — 5 МБ.`,
      status: 413,
    };
  }
  return { ok: true };
}

export function mimeToExt(mimeType: string): string {
  return ALLOWED_MIME[mimeType] ?? '.bin';
}

export const POST: APIRoute = async ({ request, locals }) => {
  // Auth check — middleware sets adminUser for /admin/** paths.
  if (!locals.adminUser) {
    return new Response(JSON.stringify({ error: 'Не авторизован.' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response(JSON.stringify({ error: 'Неверный формат запроса (ожидается multipart/form-data).' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return new Response(JSON.stringify({ error: 'Поле "file" отсутствует или не является файлом.' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const validation = validateUploadFile(file.type, file.size);
  if (!validation.ok) {
    return new Response(JSON.stringify({ error: validation.error }), {
      status: validation.status,
      headers: { 'content-type': 'application/json' },
    });
  }

  const ext = mimeToExt(file.type);
  const filename = `${randomUUID()}${ext}`;
  const uploadsDir = join(process.cwd(), 'public', 'uploads');
  mkdirSync(uploadsDir, { recursive: true });

  const arrayBuffer = await file.arrayBuffer();
  writeFileSync(join(uploadsDir, filename), Buffer.from(arrayBuffer));

  return new Response(JSON.stringify({ url: `/uploads/${filename}` }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
