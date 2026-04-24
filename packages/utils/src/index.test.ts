import { describe, expect, it } from 'vitest';

import { createPackageName, invariant } from './index';

describe('createPackageName', () => {
  it('creates a scoped package name', () => {
    expect(createPackageName('rdeam', 'utils')).toBe('@rdeam/utils');
  });
});

describe('invariant', () => {
  it('throws when the condition is false', () => {
    expect(() => invariant(false, 'boom')).toThrow('boom');
  });
});
