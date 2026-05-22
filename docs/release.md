# 发布方式

本仓库使用 **Nx Release** 在本地完成校验、版本更新、changelog、git tag 和 npm publish。整个流程不依赖 GitHub Actions。

## 准备

发布前先登录 npm：

```bash
npm login
npm whoami
```

## 标准流程

**1. 预览本次发布会做什么**（强烈建议每次先 dry-run）：

```bash
pnpm release:nx:dry
```

**2. 按 Conventional Commits 自动判断版本并发布**：

```bash
pnpm release:nx
```

如果本次提交不符合 Conventional Commits、或你想强制指定级别：

```bash
pnpm release:nx:patch
pnpm release:nx:minor
pnpm release:nx:major
```

**3. 推送 release commit 和 tags**：

```bash
pnpm release:nx:push
```

## 发布命令具体做什么

`pnpm release:nx` 会按下面顺序执行：

1. 跑 `pnpm verify`（格式检查 + lint + 全量测试 + 构建 + `publint` 包检查），任何一步失败则中止
2. 按 conventional commits 推断每个改动包的版本级别
3. 写入对应包的 `package.json#version` 和项目级 `CHANGELOG.md`
4. 创建一个 release commit（`chore(release): publish`）
5. 为每个发布的包打 tag（`<package-name>@<version>`）
6. 跑 `npm publish` 把包发到 npm registry

注意：`release:nx` 默认**不**自动 push。需要 `pnpm release:nx:push` 单独推。

## 提交信息规则

仓库通过 husky `commit-msg` hook + `@commitlint/config-conventional` 强制校验提交信息。不符合 Conventional Commits 的提交会被本地拦截。

`pnpm release:nx` 按照同一套规则自动推断版本级别：

| commit message                   | 推断版本 |
| -------------------------------- | -------- |
| `fix(utils): 修复工具函数边界`   | patch    |
| `feat(resolver): 支持新命名规则` | minor    |
| `feat(utils)!: 调整公开 API`     | major    |
| `chore: 内部调整`                | 不发版   |

允许的 type：`feat`、`fix`、`docs`、`style`、`refactor`、`perf`、`test`、`build`、`ci`、`chore`、`revert`。

scope 推荐使用 Nx 项目名：

```
utils
vue-components-resolver
vite-plugin-element-plus-theme-builder
pinia-plugin-uni-persist-next
```

如果某次提交确实需要绕过 commitlint（极少见，比如手动 `git revert`），可以用 `git commit --no-verify`。

## 仅校验，不发布

如果你只想确认当前改动是否能通过发布前所有检查：

```bash
pnpm verify
```

等价于 `format:check && lint && test && pack:check`。CI 也跑同一套。
