import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { compileStringAsync } from 'sass';
import type { Plugin } from 'vite';

export interface ThemeColorPalette {
  primary: string;
  success: string;
  warning: string;
  danger: string;
  error: string;
  info: string;
}

export interface ElementPlusThemePluginOptions {
  outputCssPath?: string;
  scanSourceDir?: string;
  scanFilePattern?: RegExp;
  elementPlusThemeChalkDir?: string;
  colors?: Partial<ThemeColorPalette>;
  alwaysIncludeComponents?: string[];
}

interface ResolvedOptions {
  outputCssPath: string;
  scanSourceDir: string;
  scanFilePattern: RegExp;
  elementPlusThemeChalkDir: string;
  colors: ThemeColorPalette;
  alwaysIncludeComponents: string[];
}

type BuildCommand = 'serve' | 'build';

const DEFAULT_ALWAYS_INCLUDE_COMPONENTS = [
  'base',
  'message',
  'message-box',
  'notification',
  'loading',
  'autocomplete',
  'button',
  'cascader',
  'cascader-panel',
  'checkbox',
  'checkbox-button',
  'checkbox-group',
  'color-picker',
  'color-picker-panel',
  'date-picker',
  'date-picker-panel',
  'form',
  'form-item',
  'input',
  'input-number',
  'input-tag',
  'mention',
  'option',
  'option-group',
  'radio',
  'radio-button',
  'radio-group',
  'rate',
  'segmented',
  'select',
  'select-v2',
  'slider',
  'switch',
  'time-picker',
  'time-select',
  'transfer',
  'tree-select',
  'upload',
];

const DEFAULT_OPTIONS: ResolvedOptions = {
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
  alwaysIncludeComponents: DEFAULT_ALWAYS_INCLUDE_COMPONENTS,
};

const normalizePath = (targetPath: string) => targetPath.replace(/\\/g, '/');

const ensureRelativeImportPath = (targetPath: string) => {
  const normalizedPath = normalizePath(targetPath);

  if (normalizedPath.startsWith('./') || normalizedPath.startsWith('../')) {
    return normalizedPath;
  }

  return `./${normalizedPath}`;
};

const tagToComponentName = (tagName: string) => tagName.replace(/^el-/, '');

const scriptToComponentName = (componentName: string) => {
  return componentName
    .replace(/^El/, '')
    .replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
    .replace(/^-/, '');
};

const resolveOptions = (options: ElementPlusThemePluginOptions = {}): ResolvedOptions => {
  return {
    outputCssPath: options.outputCssPath ?? DEFAULT_OPTIONS.outputCssPath,
    scanSourceDir: options.scanSourceDir ?? DEFAULT_OPTIONS.scanSourceDir,
    scanFilePattern: options.scanFilePattern ?? DEFAULT_OPTIONS.scanFilePattern,
    elementPlusThemeChalkDir:
      options.elementPlusThemeChalkDir ?? DEFAULT_OPTIONS.elementPlusThemeChalkDir,
    colors: {
      ...DEFAULT_OPTIONS.colors,
      ...options.colors,
    },
    alwaysIncludeComponents:
      options.alwaysIncludeComponents ?? DEFAULT_OPTIONS.alwaysIncludeComponents,
  };
};

const createScssEntry = (
  themeChalkSrcPath: string,
  componentNames: string[],
  colors: ThemeColorPalette,
) => {
  const forwardPath = normalizePath(path.join(themeChalkSrcPath, 'common/var.scss'));
  const imports = componentNames
    .map((name) => normalizePath(path.join(themeChalkSrcPath, `${name}.scss`)))
    .map((filePath) => `@use "${filePath}" as *;`)
    .join('\n');

  return `@forward "${forwardPath}" with (
  $colors: (
    "primary": ("base": ${colors.primary}),
    "success": ("base": ${colors.success}),
    "warning": ("base": ${colors.warning}),
    "danger": ("base": ${colors.danger}),
    "error": ("base": ${colors.error}),
    "info": ("base": ${colors.info})
  )
);

${imports}
`;
};

const scanUsedComponents = async (root: string, options: ResolvedOptions) => {
  const srcDir = path.resolve(root, options.scanSourceDir);
  const usedComponents = new Set<string>(options.alwaysIncludeComponents);

  const srcStat = await fs.stat(srcDir).catch(() => null);
  if (!srcStat?.isDirectory()) {
    return [...usedComponents].sort();
  }

  const visit = async (targetPath: string): Promise<void> => {
    const stat = await fs.stat(targetPath);

    if (stat.isDirectory()) {
      const children = await fs.readdir(targetPath);
      await Promise.all(children.map((name) => visit(path.join(targetPath, name))));
      return;
    }

    if (!options.scanFilePattern.test(targetPath)) {
      return;
    }

    const source = await fs.readFile(targetPath, 'utf-8');
    const templateMatches = source.matchAll(/<\s*(el-[a-z0-9-]+)/g);
    const scriptMatches = source.matchAll(/\b(El[A-Z][A-Za-z]+)\b/g);

    for (const match of templateMatches) {
      usedComponents.add(tagToComponentName(match[1]));
    }

    for (const match of scriptMatches) {
      usedComponents.add(scriptToComponentName(match[1]));
    }
  };

  await visit(srcDir);
  return [...usedComponents].sort();
};

const buildThemeCss = async (root: string, command: BuildCommand, options: ResolvedOptions) => {
  const outputPath = path.resolve(root, options.outputCssPath);
  const outputDir = path.dirname(outputPath);
  const resolvedThemeChalkDir = path.isAbsolute(options.elementPlusThemeChalkDir)
    ? options.elementPlusThemeChalkDir
    : path.resolve(root, options.elementPlusThemeChalkDir);
  const themeChalkSrcImportPath = ensureRelativeImportPath(
    path.relative(root, resolvedThemeChalkDir),
  );

  const componentNames = command === 'serve' ? ['index'] : await scanUsedComponents(root, options);
  const source = createScssEntry(themeChalkSrcImportPath, componentNames, options.colors);

  await fs.mkdir(outputDir, { recursive: true });

  const result = await compileStringAsync(source, {
    loadPaths: [root],
    sourceMap: command === 'serve',
    style: command === 'serve' ? 'expanded' : 'compressed',
    syntax: 'scss',
    url: pathToFileURL(path.join(root, '__element-plus-theme-builder__.scss')),
  });

  await fs.writeFile(outputPath, result.css, 'utf-8');
};

const createPlugin = (rawOptions: ElementPlusThemePluginOptions = {}): Plugin => {
  let root = '';
  let command: BuildCommand = 'serve';
  const options = resolveOptions(rawOptions);

  return {
    name: 'element-plus-theme-builder',
    configResolved(resolvedConfig) {
      root = resolvedConfig.root;
      command = resolvedConfig.command as BuildCommand;
    },
    async buildStart() {
      await buildThemeCss(root, command, options);
    },
  };
};

export const elementPlusThemeBuilder = (options: ElementPlusThemePluginOptions = {}): Plugin => {
  return createPlugin(options);
};
