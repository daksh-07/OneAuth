import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** Parses the design tokens from globals.css and checks WCAG 2.x contrast for every text pairing we use. */
const css = readFileSync(path.join(import.meta.dirname, '../../app/globals.css'), 'utf8');

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

type RGBA = [number, number, number, number];
function parse(c: string): RGBA {
  if (c.startsWith('#')) {
    const h = c.slice(1);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  const m = c.match(/rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)/);
  if (!m) throw new Error(`unparsed colour ${c}`);
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
}
function over(top: RGBA, bottom: RGBA): RGBA {
  const a = top[3];
  return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a), 1];
}
function lum([r, g, b]: RGBA) {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(fg: RGBA, bg: RGBA) {
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

const themes = { light: block(':root {'), dark: block(":root[data-theme='dark']") };

// [foreground, background, minimum]
const PAIRS: [string, string, number][] = [
  ['fg', 'canvas', 4.5],
  ['fg', 'surface', 4.5],
  ['fg-muted', 'canvas', 4.5],
  ['fg-muted', 'surface', 4.5],
  ['fg-muted', 'surface-sunken', 4.5],
  ['accent-fg', 'accent', 4.5],
  ['danger-fg', 'danger', 4.5],
  ['accent-text', 'surface', 4.5],
  ['accent-text', 'accent-soft', 4.5],
  ['success', 'success-soft', 4.5],
  ['warning', 'warning-soft', 4.5],
  ['danger', 'danger-soft', 4.5],
  ['danger', 'surface', 4.5],
  ['fg', 'warning-soft', 4.5],
  ['fg-muted', 'warning-soft', 4.5],
  ['fg-muted', 'accent-soft', 4.5],
];

describe.each(Object.entries(themes))('%s theme contrast', (_name, t) => {
  it.each(PAIRS)('%s on %s ≥ %d:1', (fg, bg, min) => {
    const surface = parse(t.surface);
    const back = over(parse(t[bg]), surface);
    const front = over(parse(t[fg]), back);
    expect(ratio(front, back)).toBeGreaterThanOrEqual(min);
  });
});

it('dark tokens are defined identically for the media query and the manual override', () => {
  const media = block(":root:not([data-theme='light'])");
  expect(media).toEqual(themes.dark);
});
