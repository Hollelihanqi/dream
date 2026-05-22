import { mkdtemp, readFile, rm, writeFile, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { build, createServer } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';

import { elementPlusThemeBuilder } from './index';

let fixtureRoot: string | undefined;

const createFixture = async () => {
  fixtureRoot = await mkdtemp(path.join(tmpdir(), 'element-plus-theme-builder-'));
  await mkdir(path.join(fixtureRoot, 'src'), { recursive: true });
  await writeFile(
    path.join(fixtureRoot, 'index.html'),
    `<html><head><title>fixture</title></head><body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>`,
    'utf-8',
  );
  await writeFile(
    path.join(fixtureRoot, 'src/main.ts'),
    `
const template = '<el-table><el-table-column /></el-table><el-dialog />';
const compiled = _resolveComponent('el-popover');
console.log(template, compiled, ElTooltip);
`,
    'utf-8',
  );

  return fixtureRoot;
};

const findCssAssets = async (targetDir: string): Promise<string[]> => {
  const entries = await readdir(targetDir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(targetDir, entry.name);

      if (entry.isDirectory()) {
        return findCssAssets(entryPath);
      }

      return entry.name.endsWith('.css') ? [entryPath] : [];
    }),
  );

  return files.flat();
};

afterEach(async () => {
  if (fixtureRoot) {
    await rm(fixtureRoot, { force: true, recursive: true });
    fixtureRoot = undefined;
  }
});

describe('elementPlusThemeBuilder', () => {
  it('creates a Vite plugin with the expected name and hooks', () => {
    const plugin = elementPlusThemeBuilder();

    expect(plugin.name).toBe('element-plus-theme-builder');
    expect(plugin.configResolved).toEqual(expect.any(Function));
    expect(plugin.buildStart).toEqual(expect.any(Function));
    expect(plugin.configureServer).toEqual(expect.any(Function));
    expect(plugin.transform).toEqual(expect.any(Function));
    expect(plugin.generateBundle).toEqual(expect.any(Function));
    expect(plugin.transformIndexHtml).toEqual(
      expect.objectContaining({
        order: 'post',
        handler: expect.any(Function),
      }),
    );
  });

  it('serves the dev middleware CSS at root base (regression: must beat Vite transformMiddleware)', async () => {
    const root = await createFixture();
    const themeChalkDir = path.resolve(process.cwd(), 'node_modules/element-plus/theme-chalk/src');

    const server = await createServer({
      root,
      logLevel: 'silent',
      server: { port: 0, host: '127.0.0.1' },
      plugins: [
        elementPlusThemeBuilder({
          elementPlusThemeChalkDir: themeChalkDir,
        }),
      ],
    });

    try {
      await server.listen();

      const address = server.httpServer?.address();
      if (!address || typeof address === 'string') throw new Error('no server address');
      const url = `http://127.0.0.1:${address.port}/__element-plus-theme.css`;

      const response = await fetch(url);
      const body = await response.text();

      // 必须是真实的 CSS 内容，不能被 Vite transformMiddleware / spaFallback 截胡
      // 返回小占位响应。回归测试：上一个版本因为延后注册 middleware，
      // 这里会拿到一个几百字节的非 CSS 假响应。
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toMatch(/text\/css/);
      expect(body.length).toBeGreaterThan(100_000);
      expect(body).toContain('.el-button');
      expect(body).toContain('.el-table');
      expect(body).toContain('.el-overlay');
    } finally {
      await server.close();
    }
  });

  it('serves the dev middleware CSS under a non-root base (regression: base prefix must be honored)', async () => {
    const root = await createFixture();
    const themeChalkDir = path.resolve(process.cwd(), 'node_modules/element-plus/theme-chalk/src');

    const server = await createServer({
      root,
      base: '/sub-path/',
      logLevel: 'silent',
      server: { port: 0, host: '127.0.0.1' },
      plugins: [
        elementPlusThemeBuilder({
          elementPlusThemeChalkDir: themeChalkDir,
        }),
      ],
    });

    try {
      await server.listen();

      const address = server.httpServer?.address();
      if (!address || typeof address === 'string') throw new Error('no server address');
      const url = `http://127.0.0.1:${address.port}/sub-path/__element-plus-theme.css`;

      const response = await fetch(url);
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toMatch(/text\/css/);
      expect(body.length).toBeGreaterThan(100_000);
      expect(body).toContain('.el-button');
    } finally {
      await server.close();
    }
  });

  it('injects the dev <link> with base-aware href into index.html during serve', async () => {
    const root = await createFixture();
    const themeChalkDir = path.resolve(process.cwd(), 'node_modules/element-plus/theme-chalk/src');

    const server = await createServer({
      root,
      base: '/sub-path/',
      logLevel: 'silent',
      server: { port: 0, host: '127.0.0.1' },
      plugins: [
        elementPlusThemeBuilder({
          elementPlusThemeChalkDir: themeChalkDir,
        }),
      ],
    });

    try {
      await server.listen();
      const address = server.httpServer?.address();
      if (!address || typeof address === 'string') throw new Error('no server address');

      const html = await server.transformIndexHtml(
        '/sub-path/',
        await readFile(path.join(root, 'index.html'), 'utf-8'),
      );

      expect(html).toContain('<link rel="stylesheet" href="/sub-path/__element-plus-theme.css">');
    } finally {
      await server.close();
    }
  });

  it('emits and injects a build CSS asset containing scanned Element Plus selectors', async () => {
    const root = await createFixture();
    const themeChalkDir = path.resolve(process.cwd(), 'node_modules/element-plus/theme-chalk/src');

    await build({
      root,
      logLevel: 'silent',
      plugins: [
        elementPlusThemeBuilder({
          elementPlusThemeChalkDir: themeChalkDir,
        }),
      ],
      build: {
        emptyOutDir: true,
        minify: false,
        outDir: 'dist',
      },
    });

    const html = await readFile(path.join(root, 'dist/index.html'), 'utf-8');
    expect(html).toMatch(/<link[^>]+href="\/assets\/element-plus-theme-[^"]+\.css"/);

    const cssAssets = await findCssAssets(path.join(root, 'dist'));
    const themeAsset = cssAssets.find((file) =>
      path.basename(file).startsWith('element-plus-theme-'),
    );
    expect(themeAsset).toBeDefined();

    const css = await readFile(themeAsset!, 'utf-8');
    expect(css).toContain('.el-table');
    expect(css).toContain('.el-dialog');
    expect(css).toContain('.el-overlay');
    expect(css).toContain('.el-popover');
    expect(css).toContain('.el-tooltip');
  });
});
