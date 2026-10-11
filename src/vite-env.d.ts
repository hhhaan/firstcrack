/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly PUBLIC_SITE_URL: string;
    readonly PUBLIC_TAURI_REDIRECT: string;
    readonly VITE_SUPABASE_URL: string;
    readonly VITE_SUPABASE_ANON_KEY: string;
    readonly VITE_CUPPING_PUBLIC_BASE_URL?: string;
    /** DEV에서만 의미 있음: 'true' | '1'이면 개발 빌드에서도 Sentry를 켠다 (스모크 테스트용). */
    readonly VITE_SENTRY_SMOKE?: string;
    /** DEV에서만. 연결이 없을 때 이 레지스트리 키의 제어 화면을 보여 준다. */
    readonly VITE_DEV_ROASTER?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}

declare const __APP_VERSION__: string;
