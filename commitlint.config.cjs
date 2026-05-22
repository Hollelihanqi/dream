/**
 * commitlint 配置：在 .husky/commit-msg 里被调用，校验本仓库的提交信息。
 *
 * 规则基于 conventional-commits，是 `pnpm release:nx` 推断版本级别的依据：
 *   fix(scope): xxx              -> patch
 *   feat(scope): xxx             -> minor
 *   feat(scope)!: xxx            -> major（带 ! 表示 BREAKING）
 *   chore / docs / test / ci ... -> 不发版
 *
 * 调整说明：
 * - `subject-case` 禁用：中文 subject 没有 case 概念，开着会误报。
 * - `header-max-length` 放宽到 120：中文描述比英文长。
 * - 其它沿用 @commitlint/config-conventional 默认值。
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'subject-case': [0],
    'header-max-length': [2, 'always', 120],
  },
};
