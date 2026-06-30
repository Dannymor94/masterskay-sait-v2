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

/** Magic-byte signatures per MIME type. */
const MAGIC: Record<string, (b: Uint8Array) => boolean> = {
  'image/jpeg': (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) =>
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  'image/webp': (b) =>
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50, // WEBP
};

/**
 * Verifies that the first bytes of the file match the declared MIME type.
 * Exported for unit testing.
 */
export function validateMagicBytes(
  bytes: Uint8Array,
  mimeType: string,
): { ok: true } | { ok: false; error: string; status: number } {
  const check = MAGIC[mimeType];
  if (!check || !check(bytes)) {
    return {
      ok: false,
      error: 'Содержимое файла не соответствует заявленному типу.',
      status: 415,
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

  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  const magicCheck = validateMagicBytes(bytes, file.type);
  if (!magicCheck.ok) {
    return new Response(JSON.stringify({ error: magicCheck.error }), {
      status: magicCheck.status,
      headers: { 'content-type': 'application/json' },
    });
  }

  const ext = mimeToExt(file.type);
  const filename = `${randomUUID()}${ext}`;
  const uploadsDir = join(process.cwd(), 'public', 'uploads');
  mkdirSync(uploadsDir, { recursive: true });

  writeFileSync(join(uploadsDir, filename), Buffer.from(arrayBuffer));

  return new Response(JSON.stringify({ url: `/uploads/${filename}` }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
