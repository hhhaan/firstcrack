/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly PUBLIC_SITE_URL: string;
    readonly PUBLIC_TAURI_REDIRECT: string;
    readonly VITE_SUPABASE_URL: string;
    readonly VITE_SUPABASE_ANON_KEY: string;
    readonly VITE_R2_ACCOUNT_ID: string;
    readonly VITE_R2_ACCESS_KEY_ID: string;
    readonly VITE_R2_SECRET_ACCESS_KEY: string;
    readonly VITE_R2_BUCKET_NAME: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
