/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly PUBLIC_SITE_URL: string;
    readonly PUBLIC_TAURI_REDIRECT: string;
    readonly VITE_SUPABASE_URL: string;
    readonly VITE_SUPABASE_ANON_KEY: string;
    readonly VITE_CUPPING_PUBLIC_BASE_URL?: string;
    /** DEV에서만 의미 있음: 'true' | '1'이면 개발 빌드에서도 Sentry를 켠다 (스모크 테스트용). */
    readonly VITE_SENTRY_SMOKE?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}

declare const __APP_VERSION__: string;
