import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { compileStringAsync } from 'sass';
import type { Plugin } from 'vite';

export interface ThemeColorPalette {
  /** Element Plus 主色。 */
  primary: string;
  /** 成功色。 */
  success: string;
  /** 警告色。 */
  warning: string;
  /** 危险色。 */
  danger: string;
  /** 错误色。Element Plus 内部会单独使用 error token。 */
  error: string;
  /** 信息色。 */
  info: string;
}

export interface ElementPlusThemePluginOptions {
  /** 生成后的主题 CSS 文件路径，相对 Vite 项目根目录。 */
  outputCssPath?: string;
  /** 构建时扫描组件使用情况的源码目录。 */
  scanSourceDir?: string;
  /** 哪些文件参与组件扫描。 */
  scanFilePattern?: RegExp;
  /** Element Plus theme-chalk 的 SCSS 源码目录。 */
  elementPlusThemeChalkDir?: string;
  /** 需要覆盖的 Element Plus 主题色。 */
  colors?: Partial<ThemeColorPalette>;
  /** 无论扫描结果如何，都始终打进主题 CSS 的组件样式。 */
  alwaysIncludeComponents?: string[];
}

/** 插件内部统一使用补齐默认值后的配置，避免后续逻辑反复判断 undefined。 */
interface ResolvedOptions {
  outputCssPath: string;
  scanSourceDir: string;
  scanFilePattern: RegExp;
  elementPlusThemeChalkDir: string;
  colors: ThemeColorPalette;
  alwaysIncludeComponents: string[];
}

type BuildCommand = 'serve' | 'build';

/**
 * 构建模式会按需扫描使用到的 Element Plus 组件。
 * 但有些组件经常由函数式 API、动态组件、插件或运行时创建，源码里不一定能被正则扫描到。
 * 这些基础组件默认强制包含，避免生产 CSS 缺少弹窗、消息、表单基础样式。
 */
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

/** 统一路径分隔符，避免 Windows 反斜杠影响 Vite id 对比和 Sass import。 */
const normalizePath = (targetPath: string) => targetPath.replace(/\\/g, '/');

/** Sass @use/@forward 的相对路径必须带 ./ 或 ../，这里统一补齐。 */
const ensureRelativeImportPath = (targetPath: string) => {
  const normalizedPath = normalizePath(targetPath);

  if (normalizedPath.startsWith('./') || normalizedPath.startsWith('../')) {
    return normalizedPath;
  }

  return `./${normalizedPath}`;
};

/** 将模板里的 <el-button> 转成 theme-chalk 文件名 button。 */
const tagToComponentName = (tagName: string) => tagName.replace(/^el-/, '');

/** 将脚本里的 ElMessageBox / ElButton 转成 theme-chalk 文件名 message-box / button。 */
const scriptToComponentName = (componentName: string) => {
  return componentName
    .replace(/^El/, '')
    .replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
    .replace(/^-/, '');
};

/** 合并用户配置和默认配置。 */
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

/**
 * 生成临时 SCSS 入口。
 *
 * 这里先 @forward common/var.scss 并覆写 $colors，
 * 再 @use 需要的组件 SCSS。这样 Element Plus 每个组件都会使用同一套主题变量。
 */
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

/**
 * 构建模式下扫描项目实际使用到的 Element Plus 组件。
 *
 * 开发模式不走这个扫描，因为 dev 直接使用 Element Plus 的 index.scss 全量样式，
 * 可以减少漏扫导致的样式缺失，也避免每次源码变化都重复生成 CSS。
 */
const scanUsedComponents = async (root: string, options: ResolvedOptions) => {
  const srcDir = path.resolve(root, options.scanSourceDir);
  const usedComponents = new Set<string>(options.alwaysIncludeComponents);

  const srcStat = await fs.stat(srcDir).catch(() => null);
  if (!srcStat?.isDirectory()) {
    return [...usedComponents].sort();
  }

  /** 递归遍历源码目录，按模板标签和脚本变量名收集组件。 */
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
    // 模板组件：<el-date-picker> -> date-picker。
    const templateMatches = source.matchAll(/<\s*(el-[a-z0-9-]+)/g);
    // 脚本组件/API：ElMessageBox -> message-box。
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

/**
 * 原子写入文件。
 *
 * 不能直接写 outputCssPath，因为 Vite dev server 或其它进程可能正好在读取这个 CSS。
 * 直接写有概率暴露“写了一半”的文件，页面就会出现组件样式缺失。
 * 先写临时文件，再 rename 到目标路径，可以让外部读者只看到旧完整文件或新完整文件。
 */
const writeFileAtomic = async (targetPath: string, content: string) => {
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;

  await fs.writeFile(tempPath, content, 'utf-8');
  await fs.rename(tempPath, targetPath);
};

/**
 * 编译 Element Plus 主题 CSS。
 *
 * serve：
 * - 使用 index.scss 全量样式，保证开发时组件样式完整。
 * - 只返回 CSS 字符串，不写入真实文件。
 *
 * build：
 * - 扫描源码中实际使用到的组件，减少生产 CSS 体积。
 * - 返回 CSS 和输出路径，由调用方决定是否落盘。
 */
const buildThemeCss = async (root: string, command: BuildCommand, options: ResolvedOptions) => {
  const outputPath = path.resolve(root, options.outputCssPath);
  const outputDir = path.dirname(outputPath);
  const resolvedThemeChalkDir = path.isAbsolute(options.elementPlusThemeChalkDir)
    ? options.elementPlusThemeChalkDir
    : path.resolve(root, options.elementPlusThemeChalkDir);
  const themeChalkSrcImportPath = ensureRelativeImportPath(
    path.relative(root, resolvedThemeChalkDir),
  );

  // dev 使用全量 index；build 使用按需组件列表。
  const componentNames = command === 'serve' ? ['index'] : await scanUsedComponents(root, options);
  const source = createScssEntry(themeChalkSrcImportPath, componentNames, options.colors);

  // build 模式需要目录存在；serve 模式虽然不写文件，但这里保留目录创建不会产生副作用。
  await fs.mkdir(outputDir, { recursive: true });

  const result = await compileStringAsync(source, {
    loadPaths: [root],
    sourceMap: command === 'serve',
    style: command === 'serve' ? 'expanded' : 'compressed',
    syntax: 'scss',
    url: pathToFileURL(path.join(root, '__element-plus-theme-builder__.scss')),
  });

  return {
    css: result.css,
    outputDir,
    outputPath,
  };
};

const createPlugin = (rawOptions: ElementPlusThemePluginOptions = {}): Plugin => {
  // Vite 项目根目录，在 configResolved 里拿到。
  let root = '';
  // 当前 Vite 命令：pnpm dev 是 serve，pnpm build 是 build。
  let command: BuildCommand = 'serve';
  // 目标 CSS 的绝对路径。
  let outputPath = '';
  // 标准化后的目标 CSS 绝对路径，用于和 Vite 模块 id 做比较。
  let outputPathNormalized = '';
  // dev 模式下的内存 CSS 内容。业务代码 import CSS 时，load hook 直接返回它。
  let virtualThemeCss = '';
  // 防止同一轮启动中并发触发多次编译。
  let buildPromise: Promise<void> | null = null;
  const options = resolveOptions(rawOptions);

  /** 判断当前 Vite 请求是否就是用户配置的 outputCssPath。 */
  const isThemeCssRequest = (id: string) => {
    const cleanId = id.split('?')[0];
    return normalizePath(cleanId) === outputPathNormalized;
  };

  /**
   * 确保主题 CSS 已经生成。
   *
   * serve：
   * - 编译一次后存入 virtualThemeCss。
   * - 不写 outputCssPath，避免 dev server 读到半生成文件。
   *
   * build：
   * - 编译后原子写入 outputCssPath。
   */
  const ensureThemeCss = () => {
    if (!buildPromise) {
      buildPromise = buildThemeCss(root, command, options).then(async (result) => {
        virtualThemeCss = result.css;

        if (command === 'build') {
          await fs.mkdir(result.outputDir, { recursive: true });
          await writeFileAtomic(result.outputPath, result.css);
        }
      });
    }

    return buildPromise;
  };

  return {
    name: 'element-plus-theme-builder',
    // 提前拦截 CSS 模块解析，确保业务 import 的 generated CSS 被本插件接管。
    enforce: 'pre',
    configResolved(resolvedConfig) {
      root = resolvedConfig.root;
      command = resolvedConfig.command as BuildCommand;
      outputPath = path.resolve(root, options.outputCssPath);
      outputPathNormalized = normalizePath(outputPath);
    },
    async buildStart() {
      // 生产构建阶段要生成真实 CSS 文件，供构建结果和后续提交/发布使用。
      if (command === 'build') {
        await ensureThemeCss();
      }
    },
    async configureServer() {
      // 开发服务启动时只预生成内存 CSS，不落盘。
      await ensureThemeCss();
    },
    resolveId(id, importer) {
      // build 模式交给 Vite 正常处理真实 CSS 文件；serve 模式由插件返回内存 CSS。
      if (command !== 'serve') {
        return null;
      }

      // 处理绝对路径导入。
      if (path.isAbsolute(id) && isThemeCssRequest(id)) {
        return outputPath;
      }

      // 处理相对路径导入，例如 src/main.ts 中的 ./assets/generated/element-plus-theme.css。
      if (importer) {
        const resolvedId = path.resolve(path.dirname(importer.split('?')[0]), id);
        if (isThemeCssRequest(resolvedId)) {
          return outputPath;
        }
      }

      return null;
    },
    async load(id) {
      // dev 模式下，用户 import 目标 CSS 文件时，直接返回内存 CSS 内容。
      if (command !== 'serve' || !isThemeCssRequest(id)) {
        return null;
      }

      await ensureThemeCss();
      return virtualThemeCss;
    },
  };
};

/** 插件对外入口。 */
export const elementPlusThemeBuilder = (options: ElementPlusThemePluginOptions = {}): Plugin => {
  return createPlugin(options);
};
