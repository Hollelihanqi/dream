# @rdeam/vue-components-resolver

`AppComponentsResolver` 是一个用于 `unplugin-vue-components` 的自定义组件自动导入解析器。

它默认扫描当前项目的 `src/components` 顶层入口，并把符合约定的组件注册给 `unplugin-vue-components`，让页面模板可以直接使用通用组件。

## 为什么这么做

项目里的通用组件通常会放在 `src/components` 下。如果每个页面都手动写 `import`，会有几个问题：

- 组件一多，页面顶部的 `import` 会越来越乱。
- 同一个组件在不同页面反复手写，重复代码很多。
- 组件目录调整后，很多页面都要跟着改导入路径。

同时也不建议把所有组件一次性全局注册。全局注册会让页面依赖边界变得不清晰，也可能让未使用的组件依赖进入构建结果。

使用 `AppComponentsResolver` 后，通用组件可以直接在模板里使用，并且仍然保持按使用位置自动导入。

## 安装

```bash
pnpm add -D @rdeam/vue-components-resolver unplugin-vue-components
```

## 在 Vite 中接入

```ts
import { defineConfig } from 'vite';
import Components from 'unplugin-vue-components/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';

import { AppComponentsResolver } from '@rdeam/vue-components-resolver';

export default defineConfig({
  plugins: [
    Components({
      dirs: [],
      resolvers: [
        ElementPlusResolver({
          importStyle: false,
        }),
        AppComponentsResolver(),
      ],
      dts: 'src/types/components.d.ts',
    }),
  ],
});
```

`dirs: []` 用于关闭 `unplugin-vue-components` 默认目录扫描，只保留自定义解析规则。

## 配置项

### componentsDir

组件扫描目录，基于当前项目的 `process.cwd()` 解析。

默认值：

```ts
AppComponentsResolver({
  componentsDir: 'src/components',
});
```

自定义目录：

```ts
AppComponentsResolver({
  componentsDir: 'src/shared/components',
});
```

当目录以 `src/` 开头时，导入路径会自动转成常见的 `@/` 别名：

```text
src/components/BaseButton.vue -> @/components/BaseButton.vue
src/shared/components/QueryPanel.vue -> @/shared/components/QueryPanel.vue
```

### importBase

生成自动导入时使用的路径前缀。

如果 Vite 项目没有配置 `@ -> src` 别名，可以显式指定：

```ts
AppComponentsResolver({
  componentsDir: 'src/shared/components',
  importBase: '/src/shared/components',
});
```

这会生成：

```text
src/shared/components/QueryPanel.vue -> /src/shared/components/QueryPanel.vue
```

## 支持的模板写法

同一个组件会同时注册为 `PascalCase`、`camelCase` 和 `kebab-case`。

```vue
<template>
  <ProTable />
  <proTable />
  <pro-table />
</template>
```

## 支持的组件定义方式

顶层单文件组件：

```text
src/components/BaseButton.vue
src/components/UserCard.vue
```

目录组件：

```text
src/components/pro-table/ProTable.vue
src/components/user-form/Index.vue
src/components/search-form/index.ts
src/components/sticky-container/index.tsx
```

目录组件查找顺序：

```text
1. 组件目录/组件名.vue
2. 组件目录/Index.vue
3. 组件目录/index.ts
4. 组件目录/index.tsx
```

只要命中其中一个入口，就会立即注册并结束当前目录的查找。

## 源码入口

```ts
import { AppComponentsResolver } from '@rdeam/vue-components-resolver';
```
