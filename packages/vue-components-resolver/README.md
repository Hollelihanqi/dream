# AppComponentsResolver

`AppComponentsResolver` 是一个用于 `unplugin-vue-components` 的自定义组件自动导入解析器。

它默认扫描当前项目的 `src/components` 顶层入口，并把符合约定的组件注册给 `unplugin-vue-components`，让页面模板可以直接使用通用组件。

## 1. 为什么这么做

项目里的通用组件通常会放在 `src/components` 下，如果每个页面都手动写 `import`，会有几个问题：

- 组件一多，页面顶部的 `import` 会越来越乱。
- 同一个组件在不同页面反复手写，重复代码很多。
- 组件目录调整后，很多页面都要跟着改导入路径。

还有一个更重要的问题，是不要把组件做成全局统一注册。

如果在项目入口里把一批组件一次性全局注册，即使某个路由页面没有使用这些组件，这些组件依赖也有可能跟着一起进入构建结果。这样会让页面依赖边界变得不清晰，也不利于按使用位置维持组件引入关系。

加上 `AppComponentsResolver` 之后，这些通用组件可以直接在模板里使用，不用再手写导入。

这样做的好处主要有三个：

- 默认只处理 `src/components`，范围明确，不会把业务组件一起卷进来。
- 支持通过 `componentsDir` 配置组件目录，适配不同项目结构。
- 支持通过 `importBase` 配置导入路径前缀，不强制项目必须使用 `@` 别名。
- 组件按使用自动导入，页面代码更干净。

## 2. 安装

```bash
pnpm add -D @dream/vue-components-resolver unplugin-vue-components
```

## 3. 在 Vite 中接入

```ts
import { defineConfig } from 'vite';
import Components from 'unplugin-vue-components/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';

import { AppComponentsResolver } from '@dream/vue-components-resolver';

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

这里 `dirs: []` 不要删。

这样做的目的是关闭 `unplugin-vue-components` 默认目录扫描，只保留自己的解析规则。

## 4. 配置项

### componentsDir

组件扫描目录，基于当前项目的 `process.cwd()` 解析。

默认值：

```ts
AppComponentsResolver({
  componentsDir: 'src/components',
});
```

如果你的通用组件放在其他目录，可以这样配置：

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

如果 Vite 项目没有配置 `@ -> src` 别名，默认生成的 `@/...` 导入路径会解析失败。此时可以使用 `importBase` 显式指定导入路径前缀。

### importBase

生成自动导入时使用的路径前缀。

例如不使用 `@` 别名时，可以配置为 Vite 支持的 `/src/...` 路径：

```ts
AppComponentsResolver({
  componentsDir: 'src/shared/components',
  importBase: '/src/shared/components',
});
```

上面的配置会生成：

```text
src/shared/components/QueryPanel.vue -> /src/shared/components/QueryPanel.vue
```

如果你的项目配置了其他别名，也可以直接写成对应前缀：

```ts
AppComponentsResolver({
  componentsDir: 'src/shared/components',
  importBase: '#/shared/components',
});
```

## 5. 支持的模板写法

同一个组件会同时注册为 `PascalCase`、`camelCase` 和 `kebab-case`。

```vue
<template>
  <ProTable />
  <proTable />
  <pro-table />
</template>
```

## 6. 支持的组件定义方式

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

例如 `src/components/pro-table` 会按下面顺序查找：

```text
src/components/pro-table/ProTable.vue
src/components/pro-table/Index.vue
src/components/pro-table/index.ts
src/components/pro-table/index.tsx
```

只要命中其中一个入口，就会立即注册并结束当前目录的查找。

## 7. 在模板里直接使用

```vue
<template>
  <ProTable />
  <proTable />
  <pro-table />
</template>
```

不需要再手动写：

```ts
import ProTable from '@/components/pro-table';
```

## 8. 源码入口

```ts
import { AppComponentsResolver } from '@dream/vue-components-resolver';
```

当前源码入口位于：

```text
packages/vue-components-resolver/src/index.ts
```
