# 发布方式

本仓库保留 Changesets 发布方式，同时新增 Nx Release 本地发布方式。Nx 方式不依赖 GitHub Actions，可以在本机用命令完成校验、版本更新、changelog、git tag 和 npm publish。

## 推荐方式：Nx 本地发布

发布前先登录 npm：

```bash
npm login
npm whoami
```

预览本次发布会做什么：

```bash
pnpm release:nx:dry
```

按 Conventional Commits 自动判断版本并发布：

```bash
pnpm release:nx
```

如果本次提交信息不符合 Conventional Commits，或者你想直接指定版本级别，可以用：

```bash
pnpm release:nx:patch
pnpm release:nx:minor
pnpm release:nx:major
```

发布命令会先执行 `pnpm verify`，包括格式检查、lint、测试、构建和 `publint` 包检查。通过后 Nx 会更新对应包的 `package.json`、生成项目级 `CHANGELOG.md`、创建 release commit 和项目 tag，然后执行 npm publish。

发布成功后推送 release commit 和 tags：

```bash
pnpm release:nx:push
```

## 提交信息规则

`pnpm release:nx` 默认按 Conventional Commits 自动推断版本：

```text
fix(utils): 修复工具函数边界情况      -> patch
feat(resolver): 支持新的组件命名规则   -> minor
feat(utils)!: 调整公开 API            -> major
```

常用 scope 可以使用 Nx 项目名：

```text
utils
vue-components-resolver
vite-plugin-element-plus-theme-builder
```

## 旧方式：Changesets

旧命令仍然可用：

```bash
pnpm changeset
pnpm version-packages
pnpm release
```

如果不再需要 GitHub 自动发布，可以禁用或删除 `.github/workflows/release.yml`。CI workflow 是否保留不影响 Nx 本地发布。
