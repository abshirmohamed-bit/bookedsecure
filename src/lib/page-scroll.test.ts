import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Regression: html and body both had `overflow-x: hidden`, which made body a
 * scroll container, and body also had `overscroll-behavior-y: contain`, which
 * stopped wheel/touch scrolling from reaching the page. Pages could not scroll.
 */
const css = readFileSync('src/styles.css', 'utf8').split('\r\n').join('\n');
const rule = (selector: string) => {
  const m = css.match(new RegExp(`\\n\\s{2}${selector} \\{([\\s\\S]*?)\\n\\s{2}\\}`));
  if (!m?.[1]) throw new Error(`${selector} rule not found`);
  return m[1].replace(/\/\*[\s\S]*?\*\//g, '');
};

describe('page scrolling', () => {
  it('never puts overscroll-behavior on body', () => {
    expect(rule('body')).not.toMatch(/overscroll-behavior/);
  });
  it('clips sideways overflow without turning html/body into scroll containers', () => {
    for (const sel of ['html', 'body']) expect(rule(sel)).toMatch(/overflow-x:\s*clip;/);
  });
});
