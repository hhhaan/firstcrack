import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    { ignores: ['dist', 'src-tauri'] },
    {
        extends: [...tseslint.configs.recommended],
        files: ['**/*.{ts,tsx}'],
        languageOptions: {
            ecmaVersion: 2020,
            globals: globals.browser,
        },
        plugins: {
            'react-hooks': reactHooks,
            'react-refresh': reactRefresh,
        },
        rules: {
            ...reactHooks.configs.recommended.rules,
            'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

            // Biome이 대체하는 규칙 — ESLint에서는 off
            'react-hooks/exhaustive-deps': 'off',
            'react-hooks/set-state-in-effect': 'off',
            'react-hooks/preserve-manual-memoization': 'off',
            'react-hooks/incompatible-library': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': 'off',
        },
    },
    // type-aware 규칙 — Biome이 못 잡는 타입 기반 검사. tsconfig 프로젝트에 속한 src만 대상
    // (supabase/functions는 Deno라 projectService 파싱 불가)
    // tests: tsconfig.json exclude + tsconfig.test.json — projectService can't resolve them
    {
        files: ['src/**/*.{ts,tsx}'],
        ignores: ['src/**/*.{test,spec}.{ts,tsx}'],
        languageOptions: {
            parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
        },
        rules: {
            '@typescript-eslint/no-unnecessary-condition': 'warn',
            '@typescript-eslint/require-array-sort-compare': 'error',
            '@typescript-eslint/no-unnecessary-type-assertion': 'warn',

            // 비동기 정확성 — await 누락/promise 오용
            // Biome nursery에도 같은 룰이 있지만 타입 추론이 얕아 실측 0/112 검출 → ESLint 유지
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
            '@typescript-eslint/await-thenable': 'error',
            '@typescript-eslint/return-await': ['error', 'in-try-catch'],
        },
    },
    // FSD layer direction (alias imports only; relative same-slice imports are fine)
    {
        files: ['src/shared/**/*.{ts,tsx}'],
        ignores: ['src/**/*.{test,spec}.{ts,tsx}'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['@entities/*', '@features/*', '@widgets/*', '@views/*'],
                            message: 'FSD: shared cannot import upper layers (entities/features/widgets/views).',
                        },
                    ],
                },
            ],
        },
    },
    {
        files: ['src/entities/**/*.{ts,tsx}'],
        ignores: ['src/**/*.{test,spec}.{ts,tsx}'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['@entities/*', '@features/*', '@widgets/*', '@views/*'],
                            message:
                                'FSD: entities cannot import other entities or upper layers; route shared state via @shared.',
                        },
                    ],
                },
            ],
        },
    },
    {
        // Same-slice `@features/<self>/…` imports are allowed; cross-feature is enforced by scan/CI later.
        files: ['src/features/**/*.{ts,tsx}'],
        ignores: ['src/**/*.{test,spec}.{ts,tsx}'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['@widgets/*', '@views/*'],
                            message: 'FSD: features cannot import widgets/views; compose in widgets/views.',
                        },
                    ],
                },
            ],
        },
    },
    {
        // Widgets may compose other widgets today; only reverse view imports are hard-blocked.
        files: ['src/widgets/**/*.{ts,tsx}'],
        ignores: ['src/**/*.{test,spec}.{ts,tsx}'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['@views/*'],
                            message: 'FSD: widgets cannot import views (reverse layer).',
                        },
                    ],
                },
            ],
        },
    },
);
