import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
// @ts-expect-error process is a nodejs global
const sentryAuthToken: string | undefined = process.env.SENTRY_AUTH_TOKEN;
// @ts-expect-error process is a nodejs global
const sentryOrg: string | undefined = process.env.SENTRY_ORG;
// @ts-expect-error process is a nodejs global
const sentryProject: string | undefined = process.env.SENTRY_PROJECT;

// npm_package_version은 pnpm 스크립트로 실행될 때만 존재한다 (bare `vitest`/`vite`에서는 undefined
// → Sentry release가 조용히 깨진다). package.json을 직접 읽어 호출 경로와 무관하게 고정한다.
const appVersion: string = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

// https://vite.dev/config/
export default defineConfig(async ({ command, mode }) => {
    if (command === 'build' && mode === 'production') {
        const env = loadEnv(mode, process.cwd(), 'VITE_');
        if (!env.VITE_SUPABASE_URL?.trim() || !env.VITE_SUPABASE_ANON_KEY?.trim()) {
            throw new Error('Production build requires VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
        }
    }

    return {
        envPrefix: ['VITE_', 'PUBLIC_'],
        define: {
            __APP_VERSION__: JSON.stringify(appVersion),
        },
        build: {
            // 업로드용 소스맵은 필요하지만 배포물에 노출하지 않는다 — sentryVitePlugin이 업로드 후 삭제.
            sourcemap: sentryAuthToken ? 'hidden' : false,
        },
        plugins: [
            react(),
            tailwindcss(),
            // 토큰이 없는 로컬 빌드/개발에서는 플러그인 자체를 넣지 않는다 — 업로드 시도도, 실패도 없다.
            sentryAuthToken &&
                sentryVitePlugin({
                    org: sentryOrg,
                    project: sentryProject,
                    authToken: sentryAuthToken,
                    release: { name: `first-crack@${appVersion}` },
                    sourcemaps: {
                        filesToDeleteAfterUpload: ['./dist/**/*.map'],
                    },
                }),
        ],
        resolve: {
            alias: {
                '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
                '@entities': fileURLToPath(new URL('./src/entities', import.meta.url)),
                '@features': fileURLToPath(new URL('./src/features', import.meta.url)),
                '@views': fileURLToPath(new URL('./src/views', import.meta.url)),
                '@widgets': fileURLToPath(new URL('./src/widgets', import.meta.url)),
            },
        },
        test: {
            globals: true,
            include: ['src/**/*.{test,spec}.{ts,tsx}', 'supabase/functions/_shared/**/*.test.ts'],
            // CI has no .env — prevent createClient() throw on import chains that touch supabase.
            env: {
                VITE_SUPABASE_URL: 'https://vjdgdolfxvnxushxrmff.supabase.co',
                VITE_SUPABASE_ANON_KEY: 'test-anon-key',
            },
        },

        // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
        //
        // 1. prevent Vite from obscuring rust errors
        clearScreen: false,
        // 2. tauri expects a fixed port, fail if that port is not available
        server: {
            port: 1420,
            strictPort: true,
            host: host || false,
            hmr: host
                ? {
                      protocol: 'ws',
                      host,
                      port: 1421,
                  }
                : undefined,
            watch: {
                // 3. tell Vite to ignore watching `src-tauri`
                ignored: ['**/src-tauri/**'],
            },
        },
    };
});
