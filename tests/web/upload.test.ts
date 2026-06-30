/**
 * upload.test.ts — unit tests for validateUploadFile (T-photo-1).
 *
 * Tests the pure validation function exported from the upload endpoint.
 * No HTTP server needed — deterministic logic, no side effects.
 *
 * RED→GREEN: tests pass once validateUploadFile is implemented in upload.ts.
 */
import { describe, it, expect } from 'vitest';
import { validateUploadFile, validateMagicBytes } from '../../web/src/pages/admin/api/upload.ts';

describe('validateUploadFile', () => {
  it('accepts image/jpeg within size limit', () => {
    const result = validateUploadFile('image/jpeg', 1024 * 1024); // 1 MB
    expect(result.ok).toBe(true);
  });

  it('accepts image/png within size limit', () => {
    const result = validateUploadFile('image/png', 500);
    expect(result.ok).toBe(true);
  });

  it('accepts image/webp within size limit', () => {
    const result = validateUploadFile('image/webp', 5 * 1024 * 1024); // exactly 5 MB
    expect(result.ok).toBe(true);
  });

  it('rejects application/octet-stream with status 415', () => {
    const result = validateUploadFile('application/octet-stream', 100);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(415);
      expect(result.error).toMatch(/Недопустимый тип файла/);
    }
  });

  it('rejects text/html with status 415', () => {
    const result = validateUploadFile('text/html', 100);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(415);
    }
  });

  it('rejects file > 5MB with status 413', () => {
    const oversized = 5 * 1024 * 1024 + 1;
    const result = validateUploadFile('image/jpeg', oversized);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(413);
      expect(result.error).toMatch(/слишком большой/);
    }
  });

  it('rejects exactly 0 bytes of unknown MIME before size check', () => {
    // MIME check takes priority over size check
    const result = validateUploadFile('application/exe', 0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(415);
    }
  });
});

describe('validateMagicBytes', () => {
  it('accepts real JPEG bytes with image/jpeg', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    expect(validateMagicBytes(jpeg, 'image/jpeg').ok).toBe(true);
  });

  it('accepts real PNG bytes with image/png', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    expect(validateMagicBytes(png, 'image/png').ok).toBe(true);
  });

  it('accepts real WebP bytes with image/webp', () => {
    // RIFF....WEBP
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
    expect(validateMagicBytes(webp, 'image/webp').ok).toBe(true);
  });

  it('rejects MZ (EXE) bytes declared as image/jpeg', () => {
    const exe = new Uint8Array([0x4d, 0x5a, 0x00, 0x00]); // MZ header
    const result = validateMagicBytes(exe, 'image/jpeg');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(415);
  });

  it('rejects %PDF bytes declared as image/png', () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
    const result = validateMagicBytes(pdf, 'image/png');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(415);
  });

  it('rejects empty buffer', () => {
    const result = validateMagicBytes(new Uint8Array(0), 'image/jpeg');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(415);
  });
});
