/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly MODE: string;
  readonly BASE_URL: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
  /** Public Dropbox app key (never a secret; PKCE has no client secret). */
  readonly VITE_DROPBOX_APP_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
