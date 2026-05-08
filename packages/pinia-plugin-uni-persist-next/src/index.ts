import type { PiniaPluginContext, StateTree } from 'pinia';

export interface PersistStrategy {
  /** Storage key. Defaults to store.$id. */
  key?: string;
  /** Top-level state paths to persist. */
  paths?: string[];
  /** Override the plugin-level async write option for this strategy. */
  async?: boolean;
}

export interface PersistOptions {
  enabled?: boolean;
  /** Multiple storage strategies for the same store. */
  strategies?: PersistStrategy[];
  /** Use async writes by default. */
  async?: boolean;
  /** Called before persisted state is restored. */
  beforeRestore?: (ctx: PiniaPluginContext) => void;
  /** Called after persisted state is restored. */
  afterRestore?: (ctx: PiniaPluginContext) => void;
}

export interface PluginOptions {
  /** Shared prefix for storage keys. */
  keyPrefix?: string;
}

declare module 'pinia' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  export interface DefineStoreOptionsBase<S extends StateTree, Store> {
    persist?: PersistOptions;
  }
}

const CIRCULAR_VALUE = '[Circular]';
const DATE_VALUE_KEY = '__piniaPersistDate';

const getByteLength = (value: string): number => {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value).length;
  }

  return value.split('').reduce((length, char) => {
    const code = char.charCodeAt(0);
    return length + (code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4);
  }, 0);
};

const normalizeForJson = (value: unknown, seen = new WeakSet<object>()): unknown => {
  if (value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return { [DATE_VALUE_KEY]: value.toISOString() };

  if (Array.isArray(value)) {
    if (seen.has(value)) return CIRCULAR_VALUE;
    seen.add(value);
    return value.map((item) => normalizeForJson(item, seen));
  }

  if (typeof value === 'object' && value !== null) {
    if (seen.has(value)) return CIRCULAR_VALUE;
    seen.add(value);

    return Object.entries(value).reduce<Record<string, unknown>>((result, [key, currentValue]) => {
      result[key] = normalizeForJson(currentValue, seen);
      return result;
    }, {});
  }

  return value;
};

const reviveFromJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(reviveFromJson);

  if (typeof value === 'object' && value !== null) {
    if (
      DATE_VALUE_KEY in value &&
      typeof (value as Record<string, unknown>)[DATE_VALUE_KEY] === 'string' &&
      Object.keys(value).length === 1
    ) {
      return new Date((value as Record<string, string>)[DATE_VALUE_KEY]);
    }

    return Object.entries(value).reduce<Record<string, unknown>>((result, [key, currentValue]) => {
      result[key] = reviveFromJson(currentValue);
      return result;
    }, {});
  }

  return value;
};

const safeStringify = (value: unknown): string => {
  return JSON.stringify(normalizeForJson(value));
};

const safeParse = (value: unknown): StateTree | null => {
  if (!value) return null;

  try {
    const parsed = reviveFromJson(typeof value === 'string' ? JSON.parse(value) : value);
    return parsed && typeof parsed === 'object' ? (parsed as StateTree) : null;
  } catch (error) {
    console.error('[Pinia Persist] Parse failed:', error);
    return null;
  }
};

const pick = (state: StateTree, paths?: string[]): Partial<StateTree> => {
  if (!paths?.length) return { ...state };

  return paths.reduce<Partial<StateTree>>((result, path) => {
    if (Object.hasOwn(state, path)) {
      result[path] = state[path];
    }

    return result;
  }, {});
};

export const createUniPersistPlugin = (pluginOptions?: PluginOptions) => {
  const keyPrefix = pluginOptions?.keyPrefix ?? '';
  const getFullKey = (key: string) => `${keyPrefix}${key}`;

  return (ctx: PiniaPluginContext) => {
    const { store, options } = ctx;
    const persist = options.persist;

    if (!persist?.enabled) return;

    const strategies: PersistStrategy[] = persist.strategies?.length
      ? persist.strategies
      : [{ key: store.$id }];
    const globalAsync = persist.async ?? true;

    persist.beforeRestore?.(ctx);

    strategies.forEach((strategy) => {
      const key = getFullKey(strategy.key ?? store.$id);

      try {
        const saved = safeParse(uni.getStorageSync(key));

        if (saved) {
          store.$patch(saved);
        }
      } catch (error) {
        console.error(`[Pinia Persist] Load failed (${key}):`, error);
        uni.removeStorageSync(key);
      }
    });

    persist.afterRestore?.(ctx);

    store.$subscribe(
      (_mutation, state) => {
        strategies.forEach((strategy) => {
          const key = getFullKey(strategy.key ?? store.$id);
          const json = safeStringify(pick(state, strategy.paths));

          if (getByteLength(json) > 3.5 * 1024 * 1024) {
            console.warn(`[Pinia Persist] Data too large (${key}): > 3.5MB`);
          }

          const shouldUseAsync =
            (globalAsync && strategy.async !== false) || strategy.async === true;

          if (shouldUseAsync) {
            uni.setStorage({
              key,
              data: json,
              fail: (error) => {
                console.error(`[Pinia Persist] Async save failed (${key}):`, error);
              },
            });
            return;
          }

          try {
            uni.setStorageSync(key, json);
          } catch (error) {
            console.error(`[Pinia Persist] Sync save failed (${key}):`, error);
          }
        });
      },
      {
        detached: true,
        deep: true,
        flush: globalAsync ? 'post' : 'sync',
      },
    );

    if (typeof store.$reset === 'function') {
      const originalReset = store.$reset.bind(store);

      Object.defineProperty(store, '$reset', {
        value: () => {
          originalReset();

          strategies.forEach((strategy) => {
            try {
              uni.removeStorageSync(getFullKey(strategy.key ?? store.$id));
            } catch {
              // Ignore storage cleanup failures so reset keeps the original Pinia behavior.
            }
          });
        },
        writable: true,
        configurable: true,
      });
    }
  };
};

export const clearStore = (key: string) => uni.removeStorageSync(key);

export const clearAll = () => uni.clearStorageSync();
