import { describe, expect, it } from 'vitest';

import { elementPlusThemeBuilder } from './index';

describe('elementPlusThemeBuilder', () => {
  it('creates a Vite plugin with the expected name and hooks', () => {
    const plugin = elementPlusThemeBuilder();

    expect(plugin.name).toBe('element-plus-theme-builder');
    expect(plugin.configResolved).toEqual(expect.any(Function));
    expect(plugin.buildStart).toEqual(expect.any(Function));
    expect(plugin.configureServer).toEqual(expect.any(Function));
    expect(plugin.resolveId).toEqual(expect.any(Function));
    expect(plugin.load).toEqual(expect.any(Function));
  });
});
