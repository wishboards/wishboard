/// <reference types="vite/client" />
/// <reference types="@testing-library/jest-dom/vitest" />
interface ImportMetaEnv {
  readonly VITE_APP_VERSION: string;
  readonly VITE_GITHUB_REPO: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
