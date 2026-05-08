import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearAll, clearStore, createUniPersistPlugin } from './index';
import type { PersistOptions } from './index';

type SubscribeHandler = (mutation: unknown, state: Record<string, unknown>) => void;

const storage = new Map<string, unknown>();

const createContext = (persist?: PersistOptions) => {
  let subscription: SubscribeHandler | undefined;

  const store = {
    $id: 'user',
    $patch: vi.fn(),
    $reset: vi.fn(),
    $subscribe: vi.fn((handler: SubscribeHandler) => {
      subscription = handler;
    }),
  };

  return {
    ctx: {
      store,
      options: {
        persist,
      },
    } as never,
    store,
    trigger: (state: Record<string, unknown>) => subscription?.({}, state),
  };
};

beforeEach(() => {
  storage.clear();

  vi.stubGlobal('uni', {
    getStorageSync: vi.fn((key: string) => storage.get(key)),
    setStorage: vi.fn(({ key, data }: { key: string; data: unknown }) => {
      storage.set(key, data);
    }),
    setStorageSync: vi.fn((key: string, data: unknown) => {
      storage.set(key, data);
    }),
    removeStorageSync: vi.fn((key: string) => {
      storage.delete(key);
    }),
    clearStorageSync: vi.fn(() => {
      storage.clear();
    }),
  });
});

describe('createUniPersistPlugin', () => {
  it('restores persisted state before subscribing to changes', () => {
    storage.set('app_user', JSON.stringify({ token: 'saved' }));
    const { ctx, store } = createContext({
      enabled: true,
    });

    createUniPersistPlugin({ keyPrefix: 'app_' })(ctx);

    expect(store.$patch).toHaveBeenCalledWith({ token: 'saved' });
    expect(store.$subscribe).toHaveBeenCalledTimes(1);
  });

  it('persists selected top-level paths with async storage by default', () => {
    const { ctx, trigger } = createContext({
      enabled: true,
      strategies: [{ key: 'account', paths: ['token'] }],
    });

    createUniPersistPlugin({ keyPrefix: 'app_' })(ctx);
    trigger({ token: 'abc', ignored: true });

    expect(uni.setStorage).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'app_account',
        data: JSON.stringify({ token: 'abc' }),
      }),
    );
  });

  it('round-trips date values', () => {
    const savedAt = new Date('2026-05-08T10:00:00.000Z');
    const { ctx, store, trigger } = createContext({
      enabled: true,
    });

    createUniPersistPlugin()(ctx);
    trigger({ savedAt });

    const storedValue = storage.get('user');
    expect(typeof storedValue).toBe('string');

    storage.set('user', storedValue);
    createUniPersistPlugin()(ctx);

    expect(store.$patch).toHaveBeenLastCalledWith({ savedAt });
  });

  it('uses synchronous storage when async is disabled', () => {
    const { ctx, trigger } = createContext({
      enabled: true,
      async: false,
    });

    createUniPersistPlugin()(ctx);
    trigger({ token: 'abc' });

    expect(uni.setStorageSync).toHaveBeenCalledWith('user', JSON.stringify({ token: 'abc' }));
  });

  it('removes persisted keys after store reset', () => {
    storage.set('app_user', '{}');
    const { ctx, store } = createContext({
      enabled: true,
    });

    createUniPersistPlugin({ keyPrefix: 'app_' })(ctx);
    store.$reset();

    expect(storage.has('app_user')).toBe(false);
  });
});

describe('storage utilities', () => {
  it('clears a single key and all keys', () => {
    storage.set('user', '{}');
    storage.set('settings', '{}');

    clearStore('user');
    expect(storage.has('user')).toBe(false);

    clearAll();
    expect(storage.size).toBe(0);
  });
});
