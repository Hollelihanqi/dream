import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppComponentsResolver } from './index';

// resolver 会基于 process.cwd() 查找组件目录。
// 测试里保留原始 cwd，方便每个用例结束后恢复运行环境。
const originalCwd = process.cwd();
let workspaceRoot = '';

// 只需要模拟文件存在即可，组件内容不会参与 resolver 判断。
const touch = (filePath: string) => {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, '');
};

describe('AppComponentsResolver', () => {
  beforeEach(() => {
    // 每个用例使用独立临时目录，避免组件文件互相污染。
    workspaceRoot = path.join(tmpdir(), `dream-resolver-${randomUUID()}`);
    mkdirSync(workspaceRoot, { recursive: true });
    process.chdir(workspaceRoot);
  });

  afterEach(() => {
    // 清理临时目录，并把 cwd 还原给后续测试或命令。
    process.chdir(originalCwd);
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it('returns undefined when the default components directory does not exist', () => {
    const resolver = AppComponentsResolver();

    expect(resolver('BaseButton')).toBeUndefined();
  });

  it('resolves top-level vue files as PascalCase, camelCase, and kebab-case', () => {
    // 顶层 .vue 文件会直接作为组件入口注册。
    touch(path.join(workspaceRoot, 'src/components/TextEllipsis.vue'));

    const resolver = AppComponentsResolver();

    expect(resolver('TextEllipsis')).toEqual({ from: '@/components/TextEllipsis.vue' });
    expect(resolver('textEllipsis')).toEqual({ from: '@/components/TextEllipsis.vue' });
    expect(resolver('text-ellipsis')).toEqual({ from: '@/components/TextEllipsis.vue' });
  });

  it('resolves directory components by configured priority', () => {
    // 分别覆盖四种目录组件入口：
    // 1. 同名 Vue 文件
    // 2. Index.vue
    // 3. index.ts
    // 4. index.tsx
    touch(path.join(workspaceRoot, 'src/components/pro-table/ProTable.vue'));
    touch(path.join(workspaceRoot, 'src/components/search-form/Index.vue'));
    touch(path.join(workspaceRoot, 'src/components/action-bar/index.ts'));
    touch(path.join(workspaceRoot, 'src/components/render-cell/index.tsx'));

    const resolver = AppComponentsResolver();

    expect(resolver('ProTable')).toEqual({ from: '@/components/pro-table/ProTable.vue' });
    expect(resolver('pro-table')).toEqual({ from: '@/components/pro-table/ProTable.vue' });
    expect(resolver('searchForm')).toEqual({ from: '@/components/search-form/Index.vue' });
    expect(resolver('ActionBar')).toEqual({ from: '@/components/action-bar' });
    expect(resolver('renderCell')).toEqual({ from: '@/components/render-cell' });
  });

  it('supports a custom components directory', () => {
    touch(path.join(workspaceRoot, 'src/shared/components/QueryPanel.vue'));
    touch(path.join(workspaceRoot, 'src/shared/components/data-table/DataTable.vue'));

    const resolver = AppComponentsResolver({
      componentsDir: 'src/shared/components',
    });

    expect(resolver('QueryPanel')).toEqual({
      from: '@/shared/components/QueryPanel.vue',
    });
    expect(resolver('data-table')).toEqual({
      from: '@/shared/components/data-table/DataTable.vue',
    });
  });

  it('supports a custom import base for projects without the @ alias', () => {
    touch(path.join(workspaceRoot, 'src/shared/components/QueryPanel.vue'));

    const resolver = AppComponentsResolver({
      componentsDir: 'src/shared/components',
      importBase: '/src/shared/components',
    });

    expect(resolver('QueryPanel')).toEqual({
      from: '/src/shared/components/QueryPanel.vue',
    });
  });
});
