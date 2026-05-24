# 发布流程

本文档说明 `@rdeam/*` 包的发布流程，基于 Nx Release + Conventional Commits。

## 前置准备（首次发布前一次性配置）

### 1. 生成 npm Access Token

npm 账号开启了 2FA 后，命令行直接 `npm publish` 会要求 OTP 验证码。推荐生成一个 **Granular Access Token** 跳过 2FA，专门用于发包。

操作步骤：

1. 打开 https://www.npmjs.com/settings/你的用户名/tokens
2. 点 **Generate New Token** → **Granular Access Token**
3. 填写：
   - **Token name**：`dream-release`（或其他易识别的名字）
   - **☑️ Bypass two-factor authentication (2FA)** — **必须勾选**
   - **Allowed IP ranges**：留空
   - **Packages and scopes** → Permissions 选 **Read and write**
   - 选择 **Only select packages and scopes**，勾选 4 个包：
     - `@rdeam/utils`
     - `@rdeam/vue-components-resolver`
     - `@rdeam/vite-plugin-element-plus-theme-builder`
     - `@rdeam/pinia-plugin-uni-persist-next`
   - **Expiration**：建议 1 year（默认 30 天太短）
4. **Generate Token** → 立即复制 token（页面刷新后不再显示）

### 2. 配置本地 token

```bash
npm set //registry.npmjs.org/:_authToken=粘贴token
npm whoami   # 应输出你的 npm 用户名，确认登录成功
```

token 会写入 `~/.npmrc`，不会进入项目仓库。

---

## 日常发布流程

### 1. 提交规范的 commit

发布版本号由 **Conventional Commits** 决定，提交格式：

| 类型                           | 触发版本变化           | 示例                                  |
| ------------------------------ | ---------------------- | ------------------------------------- |
| `fix:`                         | patch（0.2.0 → 0.2.1） | `fix(utils): 修复 deepClone 循环引用` |
| `feat:`                        | minor（0.2.0 → 0.3.0） | `feat(utils): 添加 retry 工具`        |
| `BREAKING CHANGE:` 或 `feat!:` | major（0.2.0 → 1.0.0） | `feat!: 重命名导出 API`               |
| `chore: / docs: / test:`       | 无版本变化             | `docs: 更新 README`                   |

确保 commit 已经全部提交并推送到 main：

```bash
git status   # 工作区应该干净
git push
```

### 2. 执行发布

```bash
pnpm release:nx
```

完整流程：

1. 运行 `pnpm verify`（format check + lint + test + build + publint）
2. 根据 git tag 和 commit 历史自动计算每个包的新版本
3. 更新对应包的 `package.json` 版本
4. 更新对应包的 `CHANGELOG.md`
5. 创建 commit：`chore(release): publish`
6. 打 git tag：`@rdeam/{包名}@{版本}`
7. 发布到 npm

> 没有变化的包会显示 `🚫 No changes were detected`，自动跳过，不会重复发布。

### 3. 推送 commit 和 tag 到 GitHub

```bash
pnpm release:nx:push
```

等价于 `git push && git push --tags`，把 nx 自动创建的 release commit 和 tag 推到远端。

---

## 调试和预演

### Dry run（预演，不实际修改）

```bash
pnpm release:nx:dry
```

会显示每个包计算出的版本变化、要写入的 CHANGELOG、要打的 tag，但不修改任何文件。**强烈建议正式发布前先跑一次 dry run。**

### 手动指定版本类型

```bash
pnpm release:nx:patch   # 强制所有包 patch bump
pnpm release:nx:minor   # 强制所有包 minor bump
pnpm release:nx:major   # 强制所有包 major bump
```

慎用，会跳过 conventional commits 的自动推断。

---

## 故障恢复

### 场景 1：npm publish 中途失败（token 失效、网络中断、OTP 报错等）

`pnpm release:nx` 失败时，**版本 bump、CHANGELOG、git commit、git tag 通常已经完成**，只是最后一步 npm publish 没成功。这时不要重新跑 `pnpm release:nx`（它会因为没有新 commit 而跳过 publish）。

应该单独重试发布：

```bash
pnpm exec nx release publish
```

这条命令只跑 npm publish 步骤，把当前 `package.json` 里的版本直接推到 npm，不影响 git。

> Windows PowerShell 没有全局 `nx` 命令，必须用 `pnpm exec nx ...` 或 `npx nx ...`。

### 场景 2：发布后发现忘了 push

`pnpm release:nx` 默认 **不会自动 push**（在 `nx.json` 里 `release.git.push: false`）。如果只在本地完成了发布，npm 上有新版本但 GitHub 上没有 tag，运行：

```bash
pnpm release:nx:push
```

### 场景 3：token 401 Unauthorized

```bash
npm whoami
# npm error 401 Unauthorized
```

token 已经过期或失效。重新走「前置准备」第 1、2 步生成新 token 并配置。

### 场景 4：tag 模式不匹配，nx 找不到当前版本

如果看到这种警告：

```
Resolved the current version as 0.0.0 (no tag found)
```

检查 `nx.json` 的 `release.releaseTag.pattern` 是否和已有 tag 匹配。本项目使用：

```json
"releaseTag": {
  "pattern": "@rdeam/{projectName}@{version}"
}
```

对应的 tag 格式应为 `@rdeam/utils@0.1.1` 这样。

---

## 配置文件位置

| 文件                                        | 作用                                                      |
| ------------------------------------------- | --------------------------------------------------------- |
| `nx.json` → `release`                       | 发布配置：哪些包、版本策略、tag 格式、git 行为、changelog |
| `packages/*/package.json` → `publishConfig` | 发包配置（如 `access: public`）                           |
| `packages/*/package.json` → `version`       | 当前版本号，由 nx 自动维护                                |
| `packages/*/CHANGELOG.md`                   | 变更日志，由 nx 自动生成                                  |
| `~/.npmrc`                                  | npm token（**不在仓库内**）                               |

---

## 常用命令速查

| 命令                                | 说明                                          |
| ----------------------------------- | --------------------------------------------- |
| `pnpm release:nx`                   | 完整发布（版本+changelog+commit+tag+publish） |
| `pnpm release:nx:dry`               | 预演，不修改任何文件                          |
| `pnpm exec nx release publish`      | 只跑 npm publish（用于失败重试）              |
| `pnpm release:nx:push`              | 推送 commit 和 tag 到 GitHub                  |
| `pnpm release:nx:patch/minor/major` | 强制版本 bump 类型                            |
| `pnpm verify`                       | 手动跑 pre-version 检查                       |
| `npm whoami`                        | 验证 npm 登录状态                             |
