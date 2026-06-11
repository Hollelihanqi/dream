# @rdeam/pinia-plugin-uni-persist-next

专为 UniApp 打造的 Pinia 持久化插件。

## Features

- Uses UniApp storage APIs with synchronous restore and async writes by default.
- Supports per-store persistence strategies and path filtering.
- Round-trips `Date` and `BigInt` values; drops circular references safely on restore.
- Skips `undefined` fields instead of persisting `null`, keeping initial state intact.
- Warns when a single key exceeds 1MB (the WeChat mini-program per-key limit).
- Provides TypeScript types for Pinia `persist` options.

## Install

```bash
pnpm add @rdeam/pinia-plugin-uni-persist-next
```

## Usage

```ts
import { createPinia } from 'pinia';
import { createUniPersistPlugin } from '@rdeam/pinia-plugin-uni-persist-next';

const pinia = createPinia();

pinia.use(
  createUniPersistPlugin({
    keyPrefix: 'app_storage_',
  }),
);
```

```ts
import { defineStore } from 'pinia';

export const useUserStore = defineStore('user', {
  state: () => ({
    token: '',
    userInfo: null,
  }),
  persist: {
    enabled: true,
    strategies: [
      {
        key: 'user',
        paths: ['token'],
      },
    ],
  },
});
```

## Options

| Option          | Type                | Default                | Description                              |
| --------------- | ------------------- | ---------------------- | ---------------------------------------- |
| `enabled`       | `boolean`           | `false`                | Enable persistence for the store.        |
| `async`         | `boolean`           | `true`                 | Use async storage writes by default.     |
| `strategies`    | `PersistStrategy[]` | `[{ key: store.$id }]` | Storage strategies.                      |
| `beforeRestore` | `(ctx) => void`     | `undefined`            | Hook before persisted state is restored. |
| `afterRestore`  | `(ctx) => void`     | `undefined`            | Hook after persisted state is restored.  |

## Utilities

```ts
import { clearAll, clearStore } from '@rdeam/pinia-plugin-uni-persist-next';

// 删除单个 key（需传入含 keyPrefix 的完整 key）
clearStore('app_storage_user');

// 只清空指定前缀下的持久化数据（推荐，与插件 keyPrefix 保持一致）
clearAll('app_storage_');

// 不传前缀时清空整个 uni storage（包括非本插件写入的数据，慎用）
clearAll();
```

> 注意：业务 state 中请勿使用 `__piniaPersistDate` / `__piniaPersistBigInt` 字段名，
> 它们是插件还原 `Date` / `BigInt` 的保留标记。

## License

MIT
