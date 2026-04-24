# @dream/vite-plugin-element-plus-theme-builder

用于 Vite + Element Plus 项目的主题构建插件。

插件会在 Vite `serve` 或 `build` 阶段生成一份 Element Plus 主题 CSS：

- 开发模式：生成完整主题，方便本地调试。
- 构建模式：扫描源码中实际使用的 Element Plus 组件，按需生成主题样式。
- 输出结果：只写入最终 CSS 文件，不额外保留临时 SCSS 文件。

## 安装

```bash
pnpm add -D @dream/vite-plugin-element-plus-theme-builder sass
```

使用方项目还需要安装 `element-plus`。

## 快速开始

### 1. 在 Vite 配置中注册插件

```ts
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { elementPlusThemeBuilder } from '@dream/vite-plugin-element-plus-theme-builder';

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

### 2. 在应用入口引入生成后的主题 CSS

```ts
import './assets/generated/element-plus-theme.css';
```

### 3. 不要同时引入 Element Plus 默认整包样式

如果你同时引入了：

```ts
import 'element-plus/dist/index.css';
```

默认样式可能会覆盖自定义主题，导致主题色看起来没有生效。

## 完整配置

```ts
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { elementPlusThemeBuilder } from '@dream/vite-plugin-element-plus-theme-builder';

export default defineConfig({
  plugins: [
    vue(),
    elementPlusThemeBuilder({
      outputCssPath: 'src/assets/generated/element-plus-theme.css',
      scanSourceDir: 'src',
      scanFilePattern: /\.(vue|jsx|tsx)$/,
      elementPlusThemeChalkDir: 'node_modules/element-plus/theme-chalk/src',
      colors: {
        primary: '#215476',
        success: '#67c23a',
        warning: '#e6a23c',
        danger: '#f56c6c',
        error: '#f56c6c',
        info: '#909399',
      },
      alwaysIncludeComponents: ['base', 'message', 'message-box', 'notification', 'loading'],
    }),
  ],
});
```

## API

### elementPlusThemeBuilder(options?)

统一入口方法。

```ts
import { elementPlusThemeBuilder } from '@dream/vite-plugin-element-plus-theme-builder';
```

## 参数说明

| 参数                       | 类型                         | 默认值                                                          | 说明                              |
| -------------------------- | ---------------------------- | --------------------------------------------------------------- | --------------------------------- |
| `outputCssPath`            | `string`                     | `src/assets/generated/element-plus-theme.css`                   | 最终 CSS 输出路径，基于项目根目录 |
| `scanSourceDir`            | `string`                     | `src`                                                           | 源码扫描目录，基于项目根目录      |
| `scanFilePattern`          | `RegExp`                     | `/\.(vue\|jsx\|tsx)$/`                                          | 扫描文件匹配规则                  |
| `elementPlusThemeChalkDir` | `string`                     | `node_modules/element-plus/theme-chalk/src`                     | Element Plus 主题源码目录         |
| `colors`                   | `Partial<ThemeColorPalette>` | 内置默认色板                                                    | 覆盖主题色                        |
| `alwaysIncludeComponents`  | `string[]`                   | `['base', 'message', 'message-box', 'notification', 'loading']` | 构建白名单组件，始终保留这些样式  |

## 类型定义

```ts
interface ElementPlusThemePluginOptions {
  outputCssPath?: string;
  scanSourceDir?: string;
  scanFilePattern?: RegExp;
  elementPlusThemeChalkDir?: string;
  colors?: Partial<ThemeColorPalette>;
  alwaysIncludeComponents?: string[];
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

## 常见问题

### 1. 主题色没有变化

请检查：

1. 是否引入了生成后的 CSS 文件。
2. 是否仍然引入了 `element-plus/dist/index.css`。
3. 是否重启了开发服务器。
4. 浏览器是否使用了旧缓存。

### 2. 构建时报找不到 Element Plus 主题源码

请检查：

1. 是否安装了 `element-plus`。
2. `elementPlusThemeChalkDir` 是否配置正确。

### 3. 想扩展扫描类型

可以自定义 `scanFilePattern`：

```ts
elementPlusThemeBuilder({
  scanFilePattern: /\.(vue|jsx|tsx|ts)$/,
});
```

## 注意事项

- 使用方项目需要安装 `element-plus` 和 `sass`。
- 修改主题色后如未生效，请重启开发服务器。
- 路径类配置建议使用相对项目根目录的写法。
