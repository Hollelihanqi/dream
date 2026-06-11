import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearAll, clearStore, createUniPersistPlugin } from './index';
import type { PersistOptions } from './index';

type SubscribeHandler = (mutation: unknown, state: Record<string, unknown>) => void;

const storage = new Map<string, unknown>();

const createContext = (persist?: PersistOptions) => {
  let subscription: SubscribeHandler | undefined;

  const store: Record<string, unknown> & {
    $id: string;
    $patch: ReturnType<typeof vi.fn>;
    $reset: () => void;
    $subscribe: ReturnType<typeof vi.fn>;
  } = {
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
    getStorageInfoSync: vi.fn(() => ({ keys: [...storage.keys()] })),
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

  it('round-trips bigint values', () => {
    const { ctx, store, trigger } = createContext({
      enabled: true,
    });

    createUniPersistPlugin()(ctx);
    trigger({ amount: 9007199254740993n });

    createUniPersistPlugin()(ctx);

    expect(store.$patch).toHaveBeenLastCalledWith({ amount: 9007199254740993n });
  });

  it('serializes shared references without marking them circular', () => {
    const { ctx, trigger } = createContext({
      enabled: true,
    });

    createUniPersistPlugin()(ctx);

    const shared = { city: 'SH' };
    trigger({ home: shared, company: shared });

    expect(storage.get('user')).toBe(
      JSON.stringify({ home: { city: 'SH' }, company: { city: 'SH' } }),
    );
  });

  it('drops circular references instead of restoring placeholder strings', () => {
    const { ctx, store, trigger } = createContext({
      enabled: true,
    });

    createUniPersistPlugin()(ctx);

    const node: Record<string, unknown> = { name: 'root' };
    node.self = node;
    trigger({ node });

    expect(storage.get('user')).toContain('[Circular]');

    createUniPersistPlugin()(ctx);

    expect(store.$patch).toHaveBeenLastCalledWith({ node: { name: 'root' } });
  });

  it('drops undefined fields instead of persisting null', () => {
    const { ctx, trigger } = createContext({
      enabled: true,
    });

    createUniPersistPlugin()(ctx);
    trigger({ token: 'abc', draft: undefined });

    expect(storage.get('user')).toBe(JSON.stringify({ token: 'abc' }));
  });

  it('ignores corrupted persisted data', () => {
    storage.set('user', '{invalid json');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { ctx, store } = createContext({
      enabled: true,
    });

    createUniPersistPlugin()(ctx);

    expect(store.$patch).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
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

  it('does not re-persist state from the subscription fired by $reset', () => {
    const { ctx, store, trigger } = createContext({
      enabled: true,
    });

    createUniPersistPlugin()(ctx);

    store.$reset();
    // 模拟 reset 内部 $patch 触发的订阅回调（flush: 'post' 时发生在 removeStorage 之后）
    trigger({ token: '' });

    expect(storage.has('user')).toBe(false);

    // 后续正常 mutation 恢复写入
    trigger({ token: 'next' });
    expect(storage.get('user')).toBe(JSON.stringify({ token: 'next' }));
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

  it('clears only prefixed keys when a prefix is provided', () => {
    storage.set('app_user', '{}');
    storage.set('other', '{}');

    clearAll('app_');

    expect(storage.has('app_user')).toBe(false);
    expect(storage.has('other')).toBe(true);
  });
});
