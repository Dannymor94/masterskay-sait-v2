/**
 * mastera-pages.test.ts — TDD for /mastera and /mastera/[slug] pages (T-master-3).
 * File-content analysis: no HTML rendering, just source inspection.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const masteraPage = fileURLToPath(
  new URL('../../web/src/pages/mastera.astro', import.meta.url),
);
const slugPage = fileURLToPath(
  new URL('../../web/src/pages/mastera/[slug].astro', import.meta.url),
);

function read(path: string) {
  return readFileSync(path, 'utf-8');
}

const HEX_PATTERN = /#[0-9a-fA-F]{3,6}\b/g;

describe('/mastera page', () => {
  it('imports listStudioMasters', () => {
    expect(read(masteraPage)).toContain('listStudioMasters');
  });

  it('has prerender = false (SSR)', () => {
    expect(read(masteraPage)).toContain('prerender = false');
  });

  it('contains no hardcoded hex colors', () => {
    const src = read(masteraPage);
    const matches = src.match(HEX_PATTERN) ?? [];
    // allow hex in comments or strings that are clearly not CSS color values
    const cssHex = matches.filter((m) => {
      // exclude things like #main, #zayavka anchors and ids in href/for attributes
      return /^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$/.test(m);
    });
    expect(cssHex).toHaveLength(0);
  });

  it('uses data-photo-slot attribute', () => {
    expect(read(masteraPage)).toContain('data-photo-slot');
  });

  it('links to /mastera/ individual pages', () => {
    expect(read(masteraPage)).toContain('/mastera/');
  });
});

describe('/mastera/[slug] page', () => {
  it('imports getSpecialistBySlug', () => {
    expect(read(slugPage)).toContain('getSpecialistBySlug');
  });

  it('has prerender = false (SSR)', () => {
    expect(read(slugPage)).toContain('prerender = false');
  });

  it('contains CTA href to /zapis', () => {
    expect(read(slugPage)).toContain('href="/zapis"');
  });

  it('contains no hardcoded hex colors', () => {
    const src = read(slugPage);
    const matches = src.match(HEX_PATTERN) ?? [];
    const cssHex = matches.filter((m) => {
      return /^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$/.test(m);
    });
    expect(cssHex).toHaveLength(0);
  });

  it('imports publishedSlots for schedule section', () => {
    expect(read(slugPage)).toContain('publishedSlots');
  });

  it('contains breadcrumb link to /mastera', () => {
    expect(read(slugPage)).toContain('href="/mastera"');
  });

  it('uses data-photo-slot attribute', () => {
    expect(read(slugPage)).toContain('data-photo-slot');
  });
});
