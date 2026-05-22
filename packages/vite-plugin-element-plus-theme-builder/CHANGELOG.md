# @rdeam/vite-plugin-element-plus-theme-builder

## Unreleased

### Minor Changes

- Reworked production CSS generation to scan Vite-transformed modules instead of walking a
  fixed source directory.
- Emits the generated theme as a Vite build asset and injects it into HTML automatically.
- Removes the need to import a generated `src/assets/generated/element-plus-theme.css` file.

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
