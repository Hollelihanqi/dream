# @rdeam/vite-plugin-element-plus-theme-builder

## 0.2.0

### Minor Changes

- 0054968: 重写为基于 Vite 模块图的 transform 扫描 + emitFile asset 自动注入。

  **BREAKING**
  - 移除 `outputCssPath` / `scanSourceDir` 配置项，插件不再向源码目录写入文件
  - 移除应用入口手动 `import` 主题 CSS 的要求，改为 `transformIndexHtml` 自动注入 `<link>`

  **修复**
  - workspace 包、node_modules 内组件、预编译 `.vue` 等代码被原扫描遗漏导致 build 缺样式
  - dev 模式 middleware 抢在 Vite `transformMiddleware` 之前注册，修复主题 CSS 返回空占位的问题
  - Windows 下 `fs.rename` 偶发 EPERM

  **新增**
  - `scanIgnore` 性能调优配置
  - `injectTo` 控制 `<link>` 注入位置

## 0.1.5

### Patch Changes

- e48ea75: vite 实时执行 css 丢失问题

## 0.1.4

### Patch Changes

- fa8a7d0: 默认包含 Element Plus 表单控件主题样式

## 0.1.3

### Patch Changes

- 364a723: Fix README encoding.

## 0.1.2

### Patch Changes

- 54c7131: Initial public release.
