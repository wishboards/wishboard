/**
 * Runtime server config, fetched once at boot in main.tsx and stashed on
 * globalThis.__WISHBOARD_CONFIG__. Reading it here (rather than build-time
 * import.meta.env) is what lets a single image serve the correct public domain
 * on whatever host it's actually deployed to. See /api/config in the server.
 */
export interface ServerConfig {
  realtimeProvider?: string;
  domain?: string;
  apIp?: string;
  isServerless?: boolean;
  apiVersion?: string;
  appVersion?: string;
}

export function getServerConfig(): ServerConfig {
  return ((globalThis as Record<string, unknown>).__WISHBOARD_CONFIG__ as ServerConfig) ?? {};
}
