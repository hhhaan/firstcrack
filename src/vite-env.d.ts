/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly PUBLIC_SITE_URL: string;
    readonly PUBLIC_TAURI_REDIRECT: string;
    readonly VITE_SUPABASE_URL: string;
    readonly VITE_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
