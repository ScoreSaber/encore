interface ViteTypeOptions {
   strictImportMetaEnv: unknown;
}

interface ImportMetaEnv {
   readonly VITE_POSTHOG_HOST?: string;
   readonly VITE_POSTHOG_PROJECT_TOKEN?: string;
}
