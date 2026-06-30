/**
 * upload.test.ts — unit tests for validateUploadFile (T-photo-1).
 *
 * Tests the pure validation function exported from the upload endpoint.
 * No HTTP server needed — deterministic logic, no side effects.
 *
 * RED→GREEN: tests pass once validateUploadFile is implemented in upload.ts.
 */
import { describe, it, expect } from 'vitest';
import { validateUploadFile } from '../../web/src/pages/api/admin/upload.ts';

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
