import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { compileStringAsync } from 'sass';
import type { HtmlTagDescriptor, Plugin } from 'vite';

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
  /** Element Plus theme-chalk 的 SCSS 源码目录，默认相对项目根。 */
  elementPlusThemeChalkDir?: string;
  /** 需要覆盖的 Element Plus 主题色。 */
  colors?: Partial<ThemeColorPalette>;
  /** 无论模块图是否扫描到，都强制包含的组件。 */
  alwaysIncludeComponents?: string[];
  /** 哪些模块 id 参与组件扫描。 */
  scanFilePattern?: RegExp;
  /** 跳过扫描的 id 模式，命中任意一条即不扫描。 */
  scanIgnore?: RegExp[];
  /** 注入 <link> 的位置。 */
  injectTo?: 'head' | 'head-prepend' | 'body' | 'body-prepend';
}

/** 插件内部统一使用补齐默认值后的配置，避免后续逻辑反复判断 undefined。 */
interface ResolvedOptions {
  elementPlusThemeChalkDir: string;
  colors: ThemeColorPalette;
  alwaysIncludeComponents: string[];
  scanFilePattern: RegExp;
  scanIgnore: RegExp[];
  injectTo: 'head' | 'head-prepend' | 'body' | 'body-prepend';
}

type BuildCommand = 'serve' | 'build';

/**
 * 默认强制包含的组件白名单。
 *
 * transform hook 已经能跟着 Vite 模块图扫到所有出现在源码 / 编译产物 / 第三方包里的
 * `<el-xxx>`、`ElXxx`、`resolveComponent("el-xxx")` 形态。所以**普通模板组件不需要**
 * 写在这个名单里——他们一定会被扫到。
 *
 * 真正需要硬白名单兜底的，只有以下这两类静态扫描原理上无法识别的：
 *
 *   1. 函数式 API：用户写的是 `ElMessage(...)` / `ElMessageBox(...)` /
 *      `ElNotification(...)` / `ElLoading.service(...)` 这种调用，
 *      没有对应的 `<el-message>` 标签或 `ElMessage` 类型符——其中 `ElMessage` 这种
 *      标识符虽然能被 PascalCase 正则匹配，但为了保险显式声明。
 *   2. 这些函数式 API 弹出的遮罩 / 容器样式（`overlay`）和全局基础样式（`base`）。
 *
 * 其它组件（table / dialog / menu / breadcrumb / card 等）请相信 transform hook，
 * 它们会被自动扫到，不要为了"心安"硬塞进来，否则会让最终 CSS 比应有的大一圈。
 */
const DEFAULT_ALWAYS_INCLUDE_COMPONENTS = [
  'base',
  'overlay',
  'message',
  'message-box',
  'notification',
  'loading',
];

const DEFAULT_OPTIONS: ResolvedOptions = {
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
  scanFilePattern: /\.(vue|jsx|tsx|ts|js|mjs|cjs)$/,
  scanIgnore: [],
  injectTo: 'head',
};

/** dev 模式下中间件吐 CSS 的固定路径，不可配置以保持简单。 */
const DEV_VIRTUAL_CSS_PATHNAME = '/__element-plus-theme.css';

const withBase = (base: string, pathname: string) => {
  const normalizedPathname = pathname.replace(/^\//, '');

  if (!base || base === '/') {
    return `/${normalizedPathname}`;
  }

  return `${base.endsWith('/') ? base : `${base}/`}${normalizedPathname}`;
};

/** 统一路径分隔符，避免 Windows 反斜杠影响 Sass import。 */
const normalizePath = (targetPath: string) => targetPath.replace(/\\/g, '/');

/** Sass @use/@forward 的相对路径必须带 ./ 或 ../，这里统一补齐。 */
const ensureRelativeImportPath = (targetPath: string) => {
  const normalizedPath = normalizePath(targetPath);

  if (normalizedPath.startsWith('./') || normalizedPath.startsWith('../')) {
    return normalizedPath;
  }

  return `./${normalizedPath}`;
};

const getThemeChalkSrcDir = (root: string, themeChalkDir: string) => {
  return path.isAbsolute(themeChalkDir) ? themeChalkDir : path.resolve(root, themeChalkDir);
};

const getAvailableThemeComponents = async (themeChalkSrcDir: string) => {
  const files = await fs.readdir(themeChalkSrcDir);

  return new Set(
    files.filter((file) => file.endsWith('.scss')).map((file) => file.replace(/\.scss$/, '')),
  );
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
    elementPlusThemeChalkDir:
      options.elementPlusThemeChalkDir ?? DEFAULT_OPTIONS.elementPlusThemeChalkDir,
    colors: {
      ...DEFAULT_OPTIONS.colors,
      ...options.colors,
    },
    alwaysIncludeComponents:
      options.alwaysIncludeComponents ?? DEFAULT_OPTIONS.alwaysIncludeComponents,
    scanFilePattern: options.scanFilePattern ?? DEFAULT_OPTIONS.scanFilePattern,
    scanIgnore: options.scanIgnore ?? DEFAULT_OPTIONS.scanIgnore,
    injectTo: options.injectTo ?? DEFAULT_OPTIONS.injectTo,
  };
};

/**
 * 生成临时 SCSS 入口。
 *
 * 先 @forward common/var.scss 并覆写 $colors，
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

/** 编译指定组件列表的主题 CSS。 */
const compileThemeCss = async (
  root: string,
  componentNames: string[],
  colors: ThemeColorPalette,
  themeChalkDir: string,
  command: BuildCommand,
): Promise<string> => {
  const resolvedThemeChalkDir = getThemeChalkSrcDir(root, themeChalkDir);
  const availableComponents = await getAvailableThemeComponents(resolvedThemeChalkDir);
  const validComponentNames = componentNames.filter((name) => availableComponents.has(name));
  const importPath = ensureRelativeImportPath(path.relative(root, resolvedThemeChalkDir));
  const source = createScssEntry(importPath, validComponentNames, colors);

  const result = await compileStringAsync(source, {
    loadPaths: [root],
    sourceMap: command === 'serve',
    style: command === 'serve' ? 'expanded' : 'compressed',
    syntax: 'scss',
    url: pathToFileURL(path.join(root, '__element-plus-theme-builder__.scss')),
  });

  return result.css;
};

/** 从源码字符串里收集 Element Plus 组件引用。 */
const scanCode = (code: string, collected: Set<string>) => {
  // 1) kebab-case 模板写法 `<el-button>`：用户自己 .vue 文件里最常见的形态。
  //    我们注册了 enforce: 'pre' 的 transform，能在 @vitejs/plugin-vue 编译模板前
  //    拿到原始 SFC 文本，所以这条正则在用户源码里命中率最高。
  for (const match of code.matchAll(/<\s*(el-[a-z0-9-]+)/g)) {
    collected.add(tagToComponentName(match[1]));
  }

  // 2) PascalCase 标识符 `ElButton` / `ElMessageBox` 等。一次性覆盖三类场景：
  //    - 模板里的 PascalCase 标签 `<ElButton>`
  //    - 脚本里的具名 import `import { ElButton } from 'element-plus'`
  //    - unplugin-vue-components 自动注入的
  //      `import { ElButton as __unplugin_components_x } from 'element-plus'`
  for (const match of code.matchAll(/\b(El[A-Z][A-Za-z]+)\b/g)) {
    collected.add(scriptToComponentName(match[1]));
  }

  // 3) `resolveComponent("el-xxx")` —— 兜底匹配已经被编译过的 Vue 模板。
  //    场景：node_modules 里第三方 Vue 库通常是预编译 .js 形态发布的，原始
  //    `<el-button>` 已经被编译成 `_resolveComponent("el-button")` 调用，
  //    源里既没有 `<el-button>` 字面量、也没有 `ElButton` 标识符，前两条都抓不到。
  //    `_?` 前缀是因为 Vue 编译产物里实际生成的是 `_resolveComponent`（带下划线
  //    的内部别名），保留无前缀的形态以覆盖直接手写调用。
  for (const match of code.matchAll(/_?resolveComponent\s*\(\s*["'](el-[a-z0-9-]+)["']/g)) {
    collected.add(tagToComponentName(match[1]));
  }
};

/** 决定是否对某个模块 id 跑扫描。 */
const shouldScan = (id: string, options: ResolvedOptions): boolean => {
  // Rollup 虚拟模块 id 以 \0 开头，跳过避免对内部代理代码做无意义扫描。
  if (id.startsWith('\0')) return false;
  if (id.startsWith('virtual:')) return false;

  const cleanId = normalizePath(id.split('?')[0]);

  if (!options.scanFilePattern.test(cleanId)) return false;
  if (options.scanIgnore.some((re) => re.test(cleanId))) return false;

  return true;
};

const createPlugin = (rawOptions: ElementPlusThemePluginOptions = {}): Plugin => {
  const options = resolveOptions(rawOptions);

  // Vite 项目根目录、命令、base 都在 configResolved 里拿到。
  let root = '';
  let command: BuildCommand = 'serve';
  let base = '/';

  // build 模式下随模块图累积出的组件集合。
  let collected = new Set<string>(options.alwaysIncludeComponents);
  // build 阶段 emitFile 之后回填的最终带 hash 文件名，给 transformIndexHtml 用。
  let emittedAssetFileName = '';
  // dev 模式下中间件吐出的内存 CSS。
  let devThemeCss = '';

  return {
    name: 'element-plus-theme-builder',
    // pre 确保 transform 看到的是未经其它插件改写的源码（特别是 .vue 文件的原始模板）。
    enforce: 'pre',

    configResolved(resolvedConfig) {
      root = resolvedConfig.root;
      command = resolvedConfig.command as BuildCommand;
      base = resolvedConfig.base || '/';
    },

    buildStart() {
      // watch 模式下 build 可能跑多次，每次都从干净集合开始，避免越攒越多。
      if (command === 'build') {
        collected = new Set<string>(options.alwaysIncludeComponents);
        emittedAssetFileName = '';
      }
    },

    async configureServer(server) {
      // dev 一次性编译全量主题到内存，后续中间件直接吐出。
      devThemeCss = await compileThemeCss(
        root,
        ['index'],
        options.colors,
        options.elementPlusThemeChalkDir,
        'serve',
      );

      // 关键：**同步**注册（不要 return 函数延后），这样我们的中间件位于
      // Vite 内置 transformMiddleware / spaFallback 之前，能优先处理对
      // 主题 CSS 的请求。否则 transformMiddleware 会把这个虚拟 URL 当成
      // 找不到的模块返回一个空占位响应，最终样式全没。
      //
      // 同时把 base 拼进 mount 路径——因为我们在 baseMiddleware 之前，
      // 此时 req.url 还带着 base 前缀。这样 base='/' 和 base='/sub/'
      // 两种场景都能精确匹配上 transformIndexHtml 注入的 href。
      const mountPath = `${base.replace(/\/$/, '')}${DEV_VIRTUAL_CSS_PATHNAME}`;

      server.middlewares.use(mountPath, (_req, res) => {
        res.setHeader('Content-Type', 'text/css; charset=utf-8');
        res.end(devThemeCss);
      });
    },

    transform(code, id) {
      // 只在 build 阶段累积组件集合；dev 使用全量样式，不需要扫描。
      if (command !== 'build') return null;
      if (!shouldScan(id, options)) return null;

      scanCode(code, collected);
      return null;
    },

    async generateBundle() {
      // 所有模块 transform 完成后才到 generateBundle，
      // 此时 collected 是这次构建里 Vite 真正处理过的组件全集。
      if (command !== 'build') return;

      const componentNames = [...collected].sort();
      const css = await compileThemeCss(
        root,
        componentNames,
        options.colors,
        options.elementPlusThemeChalkDir,
        'build',
      );

      const referenceId = this.emitFile({
        type: 'asset',
        name: 'element-plus-theme.css',
        source: css,
      });
      emittedAssetFileName = this.getFileName(referenceId);
    },

    transformIndexHtml: {
      // post 确保所有 generateBundle 都跑完、emittedAssetFileName 已就位。
      order: 'post',
      handler(): HtmlTagDescriptor[] | undefined {
        let href: string;

        if (command === 'serve') {
          href = withBase(base, DEV_VIRTUAL_CSS_PATHNAME);
        } else if (emittedAssetFileName) {
          href = withBase(base, emittedAssetFileName);
        } else {
          // build 模式下 generateBundle 没跑（极少见，比如 SSR 流程），不注入。
          return undefined;
        }

        return [
          {
            tag: 'link',
            attrs: { rel: 'stylesheet', href },
            injectTo: options.injectTo,
          },
        ];
      },
    },
  };
};

/** 插件对外入口。 */
export const elementPlusThemeBuilder = (options: ElementPlusThemePluginOptions = {}): Plugin => {
  return createPlugin(options);
};
