import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../');

let cachedApiVersion = null;
let cachedAppVersion = null;

/**
 * Retrieves the API specification version from api/version.txt.
 * Falls back to '1.0.0' if unreadable or in isolated test sandboxes.
 * @returns {string}
 */
export function getApiVersion() {
  if (cachedApiVersion) {
    return cachedApiVersion;
  }
  try {
    const versionPath = path.join(PROJECT_ROOT, 'api', 'version.txt');
    if (fs.existsSync(versionPath)) {
      cachedApiVersion = fs.readFileSync(versionPath, 'utf8').trim();
      return cachedApiVersion;
    }
  } catch {
    // Fallback when filesystem is mocked or unavailable
  }
  return '1.0.0';
}

/**
 * Retrieves the Wishboard application version from package.json.
 * Falls back to '1.0.0' if unreadable or in isolated test sandboxes.
 * @returns {string}
 */
export function getAppVersion() {
  if (cachedAppVersion) {
    return cachedAppVersion;
  }
  try {
    const pkgPath = path.join(PROJECT_ROOT, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.version) {
        cachedAppVersion = pkg.version;
        return cachedAppVersion;
      }
    }
  } catch {
    // Fallback when filesystem is mocked or unavailable
  }
  return '1.0.0';
}

/**
 * Resets cached versions (primarily for unit test isolation).
 */
export function resetVersionCache() {
  cachedApiVersion = null;
  cachedAppVersion = null;
}
