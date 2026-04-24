# dream

用于管理个人技术栈 npm 包的 monorepo。

## 技术选型

- pnpm workspace：依赖安装、workspace 协议、本地包联动。
- Nx：任务编排、增量构建、本地缓存、依赖图。
- TypeScript：统一源码语言与类型输出。
- tsup：每个包输出 ESM、CJS 和 `.d.ts`。
- Vitest：轻量测试。
- ESLint + Prettier：代码质量与格式化。
- Changesets：变更记录、自动版本更新、npm 发布。
- GitHub Actions：CI、版本 PR、自动发布。

## 目录结构

```text
packages/
  utils/
    src/
    project.json
    package.json
```

## 常用命令

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
pnpm changeset
pnpm version-packages
pnpm release
```

## 新增包

复制 `packages/utils` 的结构，修改包名、入口和测试即可。建议所有内部依赖使用 `workspace:*`。

## 发布流程

1. 开发完成后执行 `pnpm changeset`，选择受影响的包并填写变更说明。
2. 推送到 `main` 后，Changesets workflow 会创建或更新版本 PR。
3. 合并版本 PR 后，workflow 会执行构建并发布到 npm。

GitHub 仓库需要配置 `NPM_TOKEN` secret。
