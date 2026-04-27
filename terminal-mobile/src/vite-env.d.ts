/// <reference types="vite/client" />
/// <reference path="../../terminal/src/vite-env.d.ts" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_MOBILE_DEFAULT_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
