# dream

`@rdeam/*` 系列 npm 包的 monorepo，用于管理个人技术栈的可复用工具与插件。

## 包列表

| 包名                                                                                                 | 说明                                                        |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| [`@rdeam/utils`](./packages/utils)                                                                   | 通用工具函数集合                                            |
| [`@rdeam/vue-components-resolver`](./packages/vue-components-resolver)                               | Vue 组件自动导入 Resolver（适配 `src/components` 目录约定） |
| [`@rdeam/vite-plugin-element-plus-theme-builder`](./packages/vite-plugin-element-plus-theme-builder) | Vite 插件，按自定义主题色编译 Element Plus 样式             |
| [`@rdeam/pinia-plugin-uni-persist-next`](./packages/pinia-plugin-uni-persist-next)                   | UniApp 场景下的 Pinia 持久化插件                            |

## 技术栈

- **pnpm workspace** — 依赖管理与本地包联动（`workspace:*`）
- **Nx** — 任务编排、增量构建、本地缓存、依赖图
- **Nx Release + Conventional Commits** — 版本号、CHANGELOG、tag、npm publish 全自动
- **commitlint + husky + lint-staged** — 提交规范校验与提交前自动格式化
- **TypeScript + tsup** — 统一源码语言，输出 ESM / CJS / `.d.ts`
- **Vitest** — 单元测试
- **ESLint + Prettier** — 代码质量与格式
- **publint** — 发布前包结构校验
- **GitHub Actions** — PR / push 触发 CI（format / lint / test / build）

## 环境要求

- Node.js `>= 22`
- pnpm `>= 10`

## 目录结构

```text
.
├── packages/
│   ├── utils/
│   ├── vue-components-resolver/
│   ├── vite-plugin-element-plus-theme-builder/
│   └── pinia-plugin-uni-persist-next/
│       ├── src/
│       ├── package.json
│       ├── project.json       # Nx 项目配置
│       ├── tsup.config.ts
│       ├── tsconfig.json
│       ├── CHANGELOG.md       # 由 Nx 自动维护
│       └── README.md
├── nx.json                    # Nx workspace 配置（含 release 配置）
├── commitlint.config.cjs      # 提交信息规范
├── eslint.config.mjs
├── tsconfig.base.json
└── RELEASE.md                 # 发布流程详细文档
```

## 常用命令

```bash
pnpm install        # 安装依赖
pnpm build          # 全量构建所有包
pnpm test           # 跑所有测试
pnpm lint           # ESLint 检查
pnpm format         # Prettier 格式化
pnpm verify         # format:check + lint + test + pack:check（发布前自动跑）
pnpm graph          # 打开 Nx 依赖图
```

按单个包跑任务：

```bash
pnpm nx build utils
pnpm nx test vite-plugin-element-plus-theme-builder
```

## 提交规范

本项目通过 commitlint 强制 [Conventional Commits](https://www.conventionalcommits.org/) 格式，发布版本号会根据 commit 类型自动推断：

| 类型                                 | 触发       | 示例                                  |
| ------------------------------------ | ---------- | ------------------------------------- |
| `fix:`                               | patch      | `fix(utils): 修复 deepClone 循环引用` |
| `feat:`                              | minor      | `feat(utils): 添加 retry 工具`        |
| `feat!:` / `BREAKING CHANGE:`        | major      | `feat!: 重命名导出 API`               |
| `chore: / docs: / test: / refactor:` | 无版本变化 | `docs: 更新 README`                   |

## 发布

详见 [`RELEASE.md`](./RELEASE.md)。简要流程：

```bash
pnpm release:nx:dry    # 预演，看看会发什么
pnpm release:nx        # 正式发布（自动 bump + changelog + commit + tag + npm publish）
pnpm release:nx:push   # 推送 commit 和 tag 到 GitHub
```

## 新增一个包

1. 复制 `packages/utils` 作为模板
2. 修改 `package.json` 的 `name`、`description`、`repository.directory`
3. 修改 `project.json` 的项目名
4. 改写 `src/` 下源码与测试
5. 在 `nx.json` 的 `release.projects` 数组里加上新项目名，发布时会一并参与
6. 内部依赖请使用 `workspace:*` 协议
