# @rdeam/vite-plugin-element-plus-theme-builder

用于 Vite + Element Plus 项目的主题构建插件。

插件会在 Vite `serve` 或 `build` 阶段生成一份 Element Plus 主题 CSS：

- 开发模式：生成完整主题到内存，并自动注入页面。
- 构建模式：跟随 Vite 模块图扫描实际进入产物的模块，按需生成主题样式。
- 输出结果：通过 Vite asset 输出到 `dist`，不写入源码目录。

## 安装

```bash
pnpm add -D @rdeam/vite-plugin-element-plus-theme-builder sass
```

使用方项目还需要安装 `element-plus`。

## 快速开始

### 1. 在 Vite 配置中注册插件

```ts
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { elementPlusThemeBuilder } from '@rdeam/vite-plugin-element-plus-theme-builder';

export default defineConfig({
  plugins: [
    vue(),
    elementPlusThemeBuilder({
      colors: {
        primary: '#215476',
      },
    }),
  ],
});
```

### 2. 不要手动引入生成后的主题 CSS

插件会自动向 HTML 注入主题 CSS，不需要在应用入口写：

```ts
import './assets/generated/element-plus-theme.css';
```

这类旧版本生成文件可以删除。

## 工作原理

### 开发模式（`vite dev`）

1. `configureServer` 时一次性把 Element Plus 全量 SCSS（`index.scss`）按你的色板编译到内存。
2. 在 `__element-plus-theme.css` 这个固定路径上注册一个 dev middleware，直接返回内存里的 CSS。
3. `transformIndexHtml` 把 `<link rel="stylesheet" href="${base}__element-plus-theme.css">` 注入到 `<head>`。

dev 始终是全量主题，避免热更过程中漏样式。

### 构建模式（`vite build`）

1. `transform` hook 在 Vite 处理每一个模块时都被调用，跟着模块图收集 Element Plus 组件引用。支持三种形态：
   - `<el-xxx>` kebab-case 模板用法
   - `ElXxx` PascalCase 标识符（含模板和脚本）
   - `resolveComponent("el-xxx")` 预编译过的 `.vue` 产物
2. `generateBundle` 阶段组件集合已收齐，按需编译 SCSS 得到最终 CSS。
3. 通过 `this.emitFile` 把 CSS 作为 asset 产出，Vite 给它打上 content hash。
4. `transformIndexHtml` 把指向该 asset 的 `<link>` 写进打包后的 `index.html`。

**核心保证**：只要某段代码进了产物，它就会经过 `transform`，就会被扫到。无论这段代码在你的 `src/`、`node_modules/`、workspace 兄弟包，还是预编译过的 `.js`/`.vue`。

## 完整配置

```ts
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { elementPlusThemeBuilder } from '@rdeam/vite-plugin-element-plus-theme-builder';

export default defineConfig({
  plugins: [
    vue(),
    elementPlusThemeBuilder({
      elementPlusThemeChalkDir: 'node_modules/element-plus/theme-chalk/src',
      colors: {
        primary: '#215476',
        success: '#67c23a',
        warning: '#e6a23c',
        danger: '#f56c6c',
        error: '#f56c6c',
        info: '#909399',
      },
      // 一般不需要配置；只在确实存在"运行时动态拼接出来的组件名"时才往这里加
      alwaysIncludeComponents: [
        'base',
        'overlay',
        'message',
        'message-box',
        'notification',
        'loading',
      ],
      scanFilePattern: /\.(vue|jsx|tsx|ts|js|mjs|cjs)$/,
      // 性能调优用，把确定不会引用 Element Plus 的大依赖排除掉，可选
      scanIgnore: [/node_modules\/some-huge-non-element-package\//],
      injectTo: 'head',
    }),
  ],
});
```

## API

### elementPlusThemeBuilder(options?)

统一入口方法。

```ts
import { elementPlusThemeBuilder } from '@rdeam/vite-plugin-element-plus-theme-builder';
```

## 参数说明

| 参数                       | 类型                                                   | 默认值                                                                     | 说明                                             |
| -------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------ |
| `elementPlusThemeChalkDir` | `string`                                               | `node_modules/element-plus/theme-chalk/src`                                | Element Plus 主题源码目录                        |
| `colors`                   | `Partial<ThemeColorPalette>`                           | 内置默认色板                                                               | 覆盖主题色                                       |
| `alwaysIncludeComponents`  | `string[]`                                             | `['base', 'overlay', 'message', 'message-box', 'notification', 'loading']` | 无法被静态扫描发现的组件兜底列表（详见下方说明） |
| `scanFilePattern`          | `RegExp`                                               | `/\.(vue\|jsx\|tsx\|ts\|js\|mjs\|cjs)$/`                                   | 哪些模块 id 参与组件扫描                         |
| `scanIgnore`               | `RegExp[]`                                             | `[]`                                                                       | 跳过扫描的模块 id 规则，仅做性能调优用           |
| `injectTo`                 | `'head' \| 'head-prepend' \| 'body' \| 'body-prepend'` | `'head'`                                                                   | 自动注入主题 `<link>` 的位置                     |

### 关于 `alwaysIncludeComponents`

默认列表只包含**静态扫描原理上无法识别**的几个组件：

| 组件           | 为什么扫描发现不了                                                         |
| -------------- | -------------------------------------------------------------------------- |
| `base`         | 全局基础样式，没有具体组件标识符                                           |
| `overlay`      | 被 message-box / notification 等用作背景层，但本身没有 `<el-overlay>` 标签 |
| `message`      | 调用形式是 `ElMessage(...)`，没有 `<el-message>` 标签                      |
| `message-box`  | 同上                                                                       |
| `notification` | 同上                                                                       |
| `loading`      | 调用形式是 `ElLoading.service(...)` 或 `v-loading` 指令                    |

**普通模板组件（`table` / `dialog` / `menu` / `card` / `breadcrumb` 等）请相信 transform hook，它们一定会被扫到，不要为了"心安"塞进白名单**。塞进去只会让最终 CSS 比应有的体积大一圈，把 0.2.0 按需打包的优势抵消掉。

只有以下情况才需要往 `alwaysIncludeComponents` 里加：

- 组件名完全由运行时变量拼接出来（如 `<component :is="dynamicName" />` 且 `dynamicName` 是 API 返回的字符串）
- 你确定 transform 扫不到但又必须保留的特殊场景

## 类型定义

```ts
interface ElementPlusThemePluginOptions {
  elementPlusThemeChalkDir?: string;
  colors?: Partial<ThemeColorPalette>;
  alwaysIncludeComponents?: string[];
  scanFilePattern?: RegExp;
  scanIgnore?: RegExp[];
  injectTo?: 'head' | 'head-prepend' | 'body' | 'body-prepend';
}

interface ThemeColorPalette {
  primary: string;
  success: string;
  warning: string;
  danger: string;
  error: string;
  info: string;
}
```

## 从 0.1.x 升级到 0.2.0

0.2.0 是 **BREAKING** 版本，但迁移成本很低：

```diff
  // vite.config.ts
  elementPlusThemeBuilder({
-   outputCssPath: 'src/assets/generated/element-plus-theme.css',
-   scanSourceDir: 'src',
    colors: { primary: '#215476' },
  }),
```

```diff
  // src/main.ts
- import './assets/generated/element-plus-theme.css';
```

可以一并清理：

- 删除 `src/assets/generated/` 目录（如果存在），0.2.0 不再向源码目录落盘
- `.gitignore` 里关于该目录的忽略规则也可以删

### 行为差异

| 维度                   | 0.1.x                                         | 0.2.0                                |
| ---------------------- | --------------------------------------------- | ------------------------------------ |
| 组件扫描方式           | `fs.readdir` 遍历 `<root>/<scanSourceDir>`    | `transform` hook 跟随 Vite 模块图    |
| 能否扫到 src/ 外的代码 | ✗ 漏（workspace 包、node_modules 等全部漏掉） | ✓ 只要进了产物就一定被扫到           |
| CSS 落盘               | 写到源码目录 `src/assets/generated/`          | 不落盘，通过 `emitFile` 产 asset     |
| 用户需要 import 吗     | 需要在 `main.ts` 手写 `import`                | 不需要，自动注入 `<link>`            |
| Windows 文件占用风险   | `fs.rename` EPERM 偶发                        | 全程走 Vite emitFile，无文件系统竞争 |

## 常见问题

### 1. 主题色没有变化

请检查：

1. 是否重启了开发服务器（修改 `colors` 后需要重启）
2. 浏览器是否使用了旧缓存

### 2. 构建时报找不到 Element Plus 主题源码

请检查：

1. 是否安装了 `element-plus`
2. `elementPlusThemeChalkDir` 是否配置正确，pnpm hoist 场景下可能需要显式指向 workspace 根的 `node_modules`

### 3. 想扩展扫描类型

可以自定义 `scanFilePattern`：

```ts
elementPlusThemeBuilder({
  scanFilePattern: /\.(vue|jsx|tsx|ts|js|mjs|cjs|md)$/, // 加上 .md 支持
});
```

### 4. 构建后缺少某个动态组件样式

如果组件名完全由运行时字符串拼接（如 `<component :is="api响应里的名字" />`），任何静态扫描都无法识别。可以用 `alwaysIncludeComponents` 显式兜底：

```ts
elementPlusThemeBuilder({
  // 只把"扫不到的"加进来，普通模板组件不要塞
  alwaysIncludeComponents: [
    'base',
    'overlay',
    'message',
    'message-box',
    'notification',
    'loading',
    'drawer',
  ],
});
```

### 5. 想让主题 CSS 比业务 CSS 先加载

```ts
elementPlusThemeBuilder({
  injectTo: 'head-prepend', // 主题 CSS 排在 <head> 最前面，业务样式可以覆盖它
});
```

## 注意事项

- 使用方项目需要安装 `element-plus` 和 `sass`
- 修改 `colors` 后请重启 dev server
- 插件不再向 `src/assets/generated` 写入任何文件，旧生成目录可以放心删除
- 插件不再要求/管理你对 `element-plus/dist/index.css` 的引入策略，由宿主项目自行决定
