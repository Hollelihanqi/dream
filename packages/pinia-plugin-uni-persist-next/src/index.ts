import type { PiniaPluginContext, StateTree } from 'pinia';

/** 单条持久化策略：同一个 store 可以配置多条，把不同字段拆到不同存储 key 中 */
export interface PersistStrategy {
  /**
   * 存储 key，最终落盘的 key 为 `keyPrefix + key`。
   * 不传时默认取 store.$id。
   */
  key?: string;
  /**
   * 需要持久化的顶层 state 字段名列表（仅支持顶层，不支持 'a.b' 这类嵌套路径）。
   * 不传或为空数组时持久化整个 state。
   */
  paths?: string[];
  /**
   * 覆盖插件级 async 写入配置，仅对当前策略生效：
   * - true：本策略强制走 uni.setStorage 异步写
   * - false：本策略强制走 uni.setStorageSync 同步写
   * - 不传：跟随 PersistOptions.async
   * 注意：订阅回调的 flush 时机由插件级 async 决定，策略级覆盖只影响写入 API 的选择。
   */
  async?: boolean;
}

/** store 级持久化配置，写在 defineStore 的 persist 字段上 */
export interface PersistOptions {
  /** 是否启用持久化，默认 false（必须显式开启） */
  enabled?: boolean;
  /** 多份存储策略；不传时默认一条：整个 state 存到以 store.$id 命名的 key 下 */
  strategies?: PersistStrategy[];
  /**
   * 默认是否使用异步写入，默认 true。
   * - true：uni.setStorage 异步写，订阅回调 flush: 'post'（同一 tick 内多次 mutation 合并为一次写入）
   * - false：uni.setStorageSync 同步写，订阅回调 flush: 'sync'（每次 mutation 立即写入）
   */
  async?: boolean;
  /** 恢复持久化数据之前调用（无论存储里有没有数据都会调用） */
  beforeRestore?: (ctx: PiniaPluginContext) => void;
  /** 恢复持久化数据之后调用（无论是否成功 patch 都会调用） */
  afterRestore?: (ctx: PiniaPluginContext) => void;
}

/** 插件级配置，createUniPersistPlugin 的入参 */
export interface PluginOptions {
  /** 所有存储 key 的公共前缀，用于按业务/应用隔离存储空间，例如 'app_storage_' */
  keyPrefix?: string;
}

declare module 'pinia' {
  // 给 defineStore 的 options 扩展 persist 字段，让业务侧获得类型提示
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  export interface DefineStoreOptionsBase<S extends StateTree, Store> {
    persist?: PersistOptions;
  }
}

/**
 * 循环引用占位符：序列化时遇到真正的循环引用（对象的后代又指回自身）会写入该字符串，
 * 恢复时会被剔除（对象字段直接删除、数组元素转 null），不会以字符串形式回写到 state。
 */
const CIRCULAR_VALUE = '[Circular]';

/**
 * Date 序列化标记 key：Date 实例会被序列化成 { __piniaPersistDate: ISO 字符串 } 的单字段对象，
 * 恢复时凭该标记还原为 Date 实例。业务 state 中应避免使用该保留字段名，
 * 否则形如 { __piniaPersistDate: '...' } 的普通对象恢复时会被误还原成 Date。
 */
const DATE_VALUE_KEY = '__piniaPersistDate';

/**
 * BigInt 序列化标记 key：原理同 Date。
 * JSON.stringify 遇到 BigInt 会直接抛 TypeError，所以必须在序列化前转成标记对象。
 */
const BIGINT_VALUE_KEY = '__piniaPersistBigInt';

/**
 * 单 key 写入告警阈值（字节）。
 * 微信小程序单个 key 上限为 1MB（总容量 10MB），超过后 setStorage 必然失败，
 * 因此一旦逼近该阈值就提前打 warn 提示业务侧精简持久化字段。
 */
const STORAGE_WARN_BYTES = 1024 * 1024;

/**
 * TextEncoder 实例模块级复用。
 * 订阅回调在每次 mutation 时都可能计算字节数，如果在函数内 new TextEncoder()
 * 会产生不必要的对象创建开销；部分老旧环境没有 TextEncoder，此时为 null，走手动计算分支。
 */
const textEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

/**
 * 计算字符串的 UTF-8 字节数（存储容量限制按字节算，不能用 string.length 这种 UTF-16 码元数）。
 *
 * 优先用 TextEncoder（一次 encode 拿到精确字节数）；
 * 降级分支按 Unicode 码点手动累加：
 * - 0x0000 ~ 0x007F：1 字节（ASCII）
 * - 0x0080 ~ 0x07FF：2 字节
 * - 0x0800 ~ 0xFFFF：3 字节（绝大部分中文落在这个区间）
 * - 0x10000 以上：4 字节（emoji、生僻字等增补平面字符）
 *
 * 注意必须用 for...of（按码点迭代）而不是 split('')（按码元拆分），
 * 否则 emoji 这类代理对会被拆成两个 0xD800~0xDFFF 的半截码元，各算 3 字节（共 6），
 * 而实际 UTF-8 只占 4 字节，导致结果高估且 4 字节分支永远不可达。
 */
const getByteLength = (value: string): number => {
  if (textEncoder) {
    return textEncoder.encode(value).length;
  }

  let length = 0;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    length += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return length;
};

/**
 * 把 state 规整成可被 JSON.stringify 安全序列化的结构。
 *
 * 处理规则：
 * - undefined：对象字段直接丢弃（不写 null）。这样恢复时 $patch 不会碰这个字段，
 *   保持它在 state 里的初始值（包括 undefined 本身），避免 undefined → null 的类型污染；
 *   数组元素位置不能丢（会导致下标错位），所以数组里的 undefined 转 null（与 JSON 原生行为一致）。
 * - BigInt：转成 { __piniaPersistBigInt: 十进制字符串 }，否则 JSON.stringify 直接抛错。
 * - Date：转成 { __piniaPersistDate: ISO 字符串 }，否则会被 JSON 序列化成普通字符串，恢复后类型丢失。
 * - 循环引用：写入 '[Circular]' 占位符，恢复时由 reviveFromJson 负责剔除。
 *
 * 循环检测的关键实现细节：seen 只记录"当前递归调用栈上的祖先链"，
 * 即进入一个对象时 add、递归处理完它的所有后代后立刻 delete。
 * 只有"后代指回祖先"才是真循环；如果进入后不删除（记录"所有访问过的对象"），
 * 那么同一个对象被 state 的两个字段共享引用（DAG，非循环）时，
 * 第二次遇到就会被误判成循环写成 '[Circular]'，造成静默数据丢失。
 *
 * @param value 待规整的值（通常是 pick 之后的 state 子集）
 * @param seen  当前递归祖先链上的对象集合，外部调用不需要传
 */
const normalizeForJson = (value: unknown, seen = new WeakSet<object>()): unknown => {
  // 顶层 / 数组元素的 undefined 转 null；对象字段的 undefined 在下面的 reduce 里被直接跳过
  if (value === undefined) return null;
  if (typeof value === 'bigint') return { [BIGINT_VALUE_KEY]: value.toString() };
  if (value instanceof Date) return { [DATE_VALUE_KEY]: value.toISOString() };

  if (Array.isArray(value)) {
    if (seen.has(value)) return CIRCULAR_VALUE;
    seen.add(value);
    const result = value.map((item) => normalizeForJson(item, seen));
    // 处理完后代立刻移出祖先链，否则共享引用会被误判为循环（见函数头注释）
    seen.delete(value);
    return result;
  }

  if (typeof value === 'object' && value !== null) {
    if (seen.has(value)) return CIRCULAR_VALUE;
    seen.add(value);

    const result = Object.entries(value).reduce<Record<string, unknown>>(
      (acc, [key, currentValue]) => {
        // undefined 字段不落盘：恢复时 $patch 缺少该 key，就不会覆盖 state 里的初始值
        if (currentValue === undefined) return acc;
        acc[key] = normalizeForJson(currentValue, seen);
        return acc;
      },
      {},
    );
    seen.delete(value);
    return result;
  }

  // string / number / boolean / null / function 等：function 会被 JSON.stringify 自动忽略
  return value;
};

/**
 * 还原持久化数据，是 normalizeForJson 的逆操作。
 *
 * 处理规则：
 * - { __piniaPersistDate: string } 单字段对象 → Date 实例
 * - { __piniaPersistBigInt: string } 单字段对象 → BigInt（环境不支持 BigInt 时降级为字符串）
 * - '[Circular]' 占位符：对象字段直接剔除（$patch 不会碰该字段，保留运行时初始值）；
 *   数组元素转 null（剔除会导致后续元素下标错位）。
 *   不剔除的话，占位符字符串会被 patch 回 state，把原本的对象字段污染成 string，
 *   业务侧再访问 xxx.yyy 就会直接报错。
 *
 * 标记对象的判定条件是"标记 key 的值是 string 且对象有且只有这一个 key"，
 * 双重条件可以把业务数据恰好包含同名字段时的误判概率降到最低。
 */
const reviveFromJson = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => (item === CIRCULAR_VALUE ? null : reviveFromJson(item)));
  }

  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;

    if (typeof record[DATE_VALUE_KEY] === 'string' && Object.keys(record).length === 1) {
      return new Date(record[DATE_VALUE_KEY] as string);
    }

    if (typeof record[BIGINT_VALUE_KEY] === 'string' && Object.keys(record).length === 1) {
      const raw = record[BIGINT_VALUE_KEY] as string;
      // 数据可能在支持 BigInt 的端（H5）写入、在不支持的老环境读取，降级为字符串而不是抛错
      return typeof BigInt !== 'undefined' ? BigInt(raw) : raw;
    }

    return Object.entries(record).reduce<Record<string, unknown>>((acc, [key, currentValue]) => {
      // 真循环引用的占位符不回写，保留 state 中该字段的运行时初始值
      if (currentValue === CIRCULAR_VALUE) return acc;
      acc[key] = reviveFromJson(currentValue);
      return acc;
    }, {});
  }

  return value;
};

/**
 * 序列化 state。
 * 先经过 normalizeForJson 处理 Date / BigInt / undefined / 循环引用，
 * 因此这里的 JSON.stringify 不会因为 BigInt 或循环引用而抛出。
 */
const safeStringify = (value: unknown): string => {
  return JSON.stringify(normalizeForJson(value));
};

/**
 * 解析持久化数据。
 *
 * 入参兼容两种形态：
 * - string：本插件写入的 JSON 字符串，先 JSON.parse 再还原
 * - object：某些端上 getStorageSync 可能直接返回对象（或历史数据是对象），直接走还原逻辑
 *
 * 解析失败（坏数据 / 非法 JSON）时只打日志并返回 null，
 * 绝不向外抛出——持久化数据损坏不应该阻断 store 的正常初始化。
 *
 * @returns 还原后的 state 子集；无数据或数据非法时返回 null
 */
const safeParse = (value: unknown): StateTree | null => {
  // getStorageSync 在 key 不存在时返回 ''，这里统一挡掉 '' / null / undefined
  if (!value) return null;

  try {
    const parsed = reviveFromJson(typeof value === 'string' ? JSON.parse(value) : value);
    // 顶层必须是对象才能交给 $patch；存了个裸字符串/数字之类的脏数据直接丢弃
    return parsed && typeof parsed === 'object' ? (parsed as StateTree) : null;
  } catch (error) {
    console.error('[Pinia Persist] Parse failed:', error);
    return null;
  }
};

/**
 * 按 paths 摘取 state 的顶层字段，不传 paths（或空数组）则浅拷贝整个 state。
 *
 * 浅拷贝的目的：$subscribe 回调拿到的 state 是响应式代理，
 * 直接传给序列化没问题，但摘取成普通对象可以避免把代理对象本身往外传。
 */
const pick = (state: StateTree, paths?: string[]): Partial<StateTree> => {
  if (!paths?.length) return { ...state };

  return paths.reduce<Partial<StateTree>>((result, path) => {
    // 不用 Object.hasOwn（ES2022 API）：iOS < 15.4 / 老安卓 WebView / 低版本小程序基础库不支持，
    // tsup 的 target 也不会为它注入 polyfill，故用等价的 hasOwnProperty.call
    if (Object.prototype.hasOwnProperty.call(state, path)) {
      result[path] = state[path];
    }

    return result;
  }, {});
};

/**
 * 创建 UniApp 持久化插件，挂到 pinia.use() 上。
 *
 * 整体流程（对每个开启了 persist.enabled 的 store）：
 * 1. beforeRestore 钩子
 * 2. 按策略逐个读取存储并 $patch 回 store（同步恢复，保证组件首次渲染就能拿到持久化数据）
 * 3. afterRestore 钩子
 * 4. $subscribe 监听后续 mutation，按策略序列化写入存储
 * 5. 改写 $reset：重置后顺带清掉对应的存储 key
 */
export const createUniPersistPlugin = (pluginOptions?: PluginOptions) => {
  const keyPrefix = pluginOptions?.keyPrefix ?? '';
  /** 拼上公共前缀得到最终落盘的完整 key */
  const getFullKey = (key: string) => `${keyPrefix}${key}`;

  return (ctx: PiniaPluginContext) => {
    const { store, options } = ctx;
    const persist = options.persist;

    // 未显式开启持久化的 store 直接跳过，零开销
    if (!persist?.enabled) return;

    // 未配置策略时给一条默认策略：整个 state 存到以 store.$id 命名的 key 下
    const strategies: PersistStrategy[] = persist.strategies?.length
      ? persist.strategies
      : [{ key: store.$id }];
    const globalAsync = persist.async ?? true;

    persist.beforeRestore?.(ctx);

    // ---- 恢复阶段：同步读取每个策略的存储并 patch 回 store ----
    strategies.forEach((strategy) => {
      const key = getFullKey(strategy.key ?? store.$id);

      try {
        const saved = safeParse(uni.getStorageSync(key));

        if (saved) {
          store.$patch(saved);
        }
      } catch (error) {
        // 走到这里说明 getStorageSync 或 $patch 抛了异常（safeParse 内部不抛），
        // 该 key 下是无法恢复的坏数据，移除掉以免之后每次启动都重复失败
        console.error(`[Pinia Persist] Load failed (${key}):`, error);
        uni.removeStorageSync(key);
      }
    });

    persist.afterRestore?.(ctx);

    /**
     * $reset 防回写标记。
     * $reset 内部通过 $patch 重置 state，这次 patch 同样会触发下面的订阅回调
     * （flush: 'post' 时发生在下一个 tick，即 removeStorageSync 之后），
     * 如果不拦截，刚清掉的存储 key 会立刻被"重置后的默认 state"重新写回，
     * 导致"reset 后清空存储"的语义失效。
     * 置位后由订阅回调消费（跳过一次写入并复位）。
     * 已知取舍：flush: 'post' 下若 reset 和其他 mutation 发生在同一个 tick，
     * 回调会被合并成一次并整体跳过，该 mutation 的写入会延迟到下一次 mutation。
     */
    let skipNextPersist = false;

    // ---- 写入阶段：监听 mutation，按策略持久化 ----
    store.$subscribe(
      (_mutation, state) => {
        if (skipNextPersist) {
          skipNextPersist = false;
          return;
        }

        strategies.forEach((strategy) => {
          const key = getFullKey(strategy.key ?? store.$id);
          const json = safeStringify(pick(state, strategy.paths));

          // 容量预警。快速路径：1 个 UTF-16 码元最多对应 3 个 UTF-8 字节
          // （增补平面字符是 2 码元 4 字节，平均 2 字节/码元，不会超过 3），
          // 所以 length * 3 都没过阈值时必然安全，跳过精确计算，避免每次写入都全量 encode
          if (json.length * 3 > STORAGE_WARN_BYTES && getByteLength(json) > STORAGE_WARN_BYTES) {
            console.warn(
              `[Pinia Persist] Data too large (${key}): exceeds 1MB (WeChat single-key limit)`,
            );
          }

          // 写入方式判定：策略级 async 显式配置时优先生效，否则跟随插件级
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
            // 同步写失败（容量满等）只打日志，不影响 state 本身的更新
            console.error(`[Pinia Persist] Sync save failed (${key}):`, error);
          }
        });
      },
      {
        // detached：订阅不绑定组件生命周期，组件卸载后持久化依然生效
        detached: true,
        // deep：嵌套字段变化（如 userInfo.name）也要触发写入
        deep: true,
        // 异步写入用 post（同一 tick 多次 mutation 合并为一次写入，减少 IO）；
        // 同步写入用 sync（每次 mutation 立即落盘，保证强一致）
        flush: globalAsync ? 'post' : 'sync',
      },
    );

    // ---- 改写 $reset：重置 store 后顺带清掉对应的存储 key ----
    // setup store 没有默认 $reset 实现（pinia 会抛错提示），这里也保持原样不增强
    if (typeof store.$reset === 'function') {
      const originalReset = store.$reset.bind(store);

      Object.defineProperty(store, '$reset', {
        value: () => {
          // 必须在 originalReset 之前置位：flush: 'sync' 时订阅回调在 reset 过程中同步触发
          skipNextPersist = true;

          try {
            originalReset();
          } catch (error) {
            // reset 本身失败（如 setup store 的默认实现抛错）时复位标记，
            // 避免吞掉之后第一次正常 mutation 的持久化
            skipNextPersist = false;
            throw error;
          }

          strategies.forEach((strategy) => {
            try {
              uni.removeStorageSync(getFullKey(strategy.key ?? store.$id));
            } catch {
              // 清理存储失败不影响 reset 本身，保持与原生 $reset 一致的行为
            }
          });
        },
        // writable + configurable：允许业务侧或测试再次覆盖 $reset
        writable: true,
        configurable: true,
      });
    }
  };
};

/**
 * 删除单个持久化 key。
 * 注意需传入含 keyPrefix 的完整 key，例如配置了 keyPrefix: 'app_' 的 user store 应传 'app_user'。
 */
export const clearStore = (key: string) => uni.removeStorageSync(key);

/**
 * 清空持久化数据。
 *
 * @param keyPrefix 传入时只删除该前缀下的 key（推荐，与 createUniPersistPlugin 的 keyPrefix 保持一致）；
 *                  不传时调用 uni.clearStorageSync() 清空整个 storage——
 *                  包括非本插件写入的所有数据，慎用。
 */
export const clearAll = (keyPrefix?: string) => {
  if (!keyPrefix) {
    uni.clearStorageSync();
    return;
  }

  const { keys } = uni.getStorageInfoSync();
  keys.filter((key) => key.startsWith(keyPrefix)).forEach((key) => uni.removeStorageSync(key));
};
