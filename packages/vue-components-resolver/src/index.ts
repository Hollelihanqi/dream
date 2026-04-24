import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import type { ComponentResolver } from 'unplugin-vue-components';

export interface AppComponentsResolverOptions {
  /**
   * 组件扫描目录，基于当前项目的 process.cwd() 解析。
   *
   * 默认值：src/components
   */
  componentsDir?: string;

  /**
   * 生成自动导入时使用的路径前缀。
   *
   * 默认会根据 componentsDir 推导为 @/...。
   * 如果项目没有配置 @ -> src 别名，可以显式传入 /src/components。
   */
  importBase?: string;
}

const DEFAULT_COMPONENTS_DIR = 'src/components';

// 把目录名或文件名统一转换成 PascalCase 组件名。
// 兼容项目中常见的 kebab-case、snake_case、camelCase 三种写法。
const toPascalCase = (value: string) => {
  const normalized = value
    .replace(/[-_]+([a-zA-Z0-9])/g, (_, segment: string) => segment.toUpperCase())
    .replace(/^[a-z]/, (segment) => segment.toUpperCase());

  return normalized;
};

// 基于 PascalCase 再生成一份 camelCase 名称。
const toCamelCase = (value: string) => {
  return value.charAt(0).toLowerCase() + value.slice(1);
};

// 再注册一份 kebab-case，兼容直接用 <pro-table /> 的场景。
const toKebabCase = (value: string) => {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();
};

const normalizePath = (value: string) => {
  return value.replace(/\\/g, '/');
};

const trimSlashes = (value: string) => {
  return value.replace(/^\/+|\/+$/g, '');
};

const createImportBase = (componentsDir: string, importBase?: string) => {
  if (importBase) {
    return normalizePath(importBase).replace(/\/+$/g, '');
  }

  const normalizedDir = trimSlashes(normalizePath(componentsDir));

  if (normalizedDir === 'src') {
    return '@';
  }

  if (normalizedDir.startsWith('src/')) {
    return `@/${normalizedDir.slice('src/'.length)}`;
  }

  return normalizedDir;
};

const createComponentImport = (importBase: string, ...segments: string[]) => {
  const normalizedBase = normalizePath(importBase).replace(/\/+$/g, '');
  const normalizedSegments = segments.map((segment) => trimSlashes(normalizePath(segment)));

  return [normalizedBase, ...normalizedSegments].filter(Boolean).join('/');
};

const registerComponent = (componentMap: Map<string, string>, rawName: string, from: string) => {
  const pascalName = toPascalCase(rawName);
  const camelName = toCamelCase(pascalName);
  const kebabName = toKebabCase(pascalName);

  componentMap.set(pascalName, from);
  componentMap.set(camelName, from);
  componentMap.set(kebabName, from);
};

const isFile = (filePath: string) => {
  return existsSync(filePath) && statSync(filePath).isFile();
};

const createComponentMap = (options: AppComponentsResolverOptions = {}) => {
  const componentsDir = options.componentsDir ?? DEFAULT_COMPONENTS_DIR;
  const componentsRoot = path.resolve(process.cwd(), componentsDir);
  const importBase = createImportBase(componentsDir, options.importBase);
  const componentMap = new Map<string, string>();

  if (!existsSync(componentsRoot)) {
    return componentMap;
  }

  const entries = readdirSync(componentsRoot, { withFileTypes: true });

  entries.forEach((entry) => {
    if (entry.isFile()) {
      const extension = path.extname(entry.name);
      const basename = path.basename(entry.name, extension);

      if (extension === '.vue') {
        registerComponent(componentMap, basename, createComponentImport(importBase, entry.name));
      }

      return;
    }

    if (!entry.isDirectory()) {
      return;
    }

    const folderName = entry.name;
    const componentName = toPascalCase(folderName);
    const folderPath = path.join(componentsRoot, folderName);
    const preferredVuePath = path.join(folderPath, `${componentName}.vue`);
    const indexVuePath = path.join(folderPath, 'Index.vue');
    const indexTsPath = path.join(folderPath, 'index.ts');
    const indexTsxPath = path.join(folderPath, 'index.tsx');

    if (isFile(preferredVuePath)) {
      registerComponent(
        componentMap,
        folderName,
        createComponentImport(importBase, folderName, `${componentName}.vue`),
      );
      return;
    }

    if (isFile(indexVuePath)) {
      registerComponent(
        componentMap,
        folderName,
        createComponentImport(importBase, folderName, 'Index.vue'),
      );
      return;
    }

    if (isFile(indexTsPath)) {
      registerComponent(componentMap, folderName, createComponentImport(importBase, folderName));
      return;
    }

    if (isFile(indexTsxPath)) {
      registerComponent(componentMap, folderName, createComponentImport(importBase, folderName));
    }
  });

  return componentMap;
};

export const AppComponentsResolver = (
  options: AppComponentsResolverOptions = {},
): ComponentResolver => {
  const componentMap = createComponentMap(options);

  return (name) => {
    const from = componentMap.get(name);

    if (!from) {
      return;
    }

    return {
      from,
    };
  };
};
