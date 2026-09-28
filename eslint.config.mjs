import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/**
 * 规则分级原则
 *   error = 确定会产生 bug 或让 bug 藏起来，新增代码不得用 eslint-disable 绕过
 *   warn  = 存量技术债：保留可见度，由 `--max-warnings` 做棘轮（只准降不准升）
 * 当前 warn 存量与对应的清欠任务见 docs/05-修复与收尾计划.md §4 任务 1.8。
 *
 * 类型感知规则只对 TS 文件开启：.mjs（本文件与 deploy 脚本）不进 project service。
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.vite/**',
      'data/**',
      'design/**',
      '**/*.tsbuildinfo',
    ],
  },

  js.configs.recommended,

  {
    files: ['**/*.{ts,tsx,mts}'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { args: 'all', argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],

      'react-hooks/rules-of-hooks': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/restrict-template-expressions': 'error',

      // 1.8 已把存量清到 0（2026-09-24），这些就是"确定会出 bug"的形状，升 error
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/no-base-to-string': 'error',
      'no-useless-assignment': 'error',
      '@typescript-eslint/no-unused-expressions': 'error',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      'react-refresh/only-export-components': 'error',

      // 故意留 warn：这两条要人判断，升 error 逼出来的会是满地 eslint-disable 而不是好代码。
      // 但 `--max-warnings=0` 已经让任何新增等于失败，所以留 warn 不等于放松。
      //   no-explicit-any   —— 确有不得不用 any 的边界（如第三方类型缺失）
      //   exhaustive-deps   —— 合法省略依赖的场景真实存在（稳定回调、只在挂载时跑一次）
      '@typescript-eslint/no-explicit-any': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  {
    // node:test 的 it()/describe() 返回的是调度用的 promise，本就不该被 await
    files: ['apps/server/test/**/*.ts', 'apps/server/scripts/**/*.ts', 'apps/web/test/**/*.ts'],
    rules: { '@typescript-eslint/no-floating-promises': 'off' },
  },

  {
    // deploy 脚本与根配置本身：只按普通 JS 检查，不参与类型感知
    files: ['**/*.{js,cjs,mjs}'],
    languageOptions: { globals: globals.node },
  },

  prettier,
);
