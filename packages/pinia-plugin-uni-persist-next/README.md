# @rdeam/pinia-plugin-uni-persist-next

专为 UniApp 打造的 Pinia 持久化插件。

## Features

- Uses UniApp storage APIs with synchronous restore and async writes by default.
- Supports per-store persistence strategies and path filtering.
- Handles `Date`, circular references and `BigInt` values during serialization.
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

clearStore('app_storage_user');
clearAll();
```

## License

MIT
