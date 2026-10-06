import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const FONTS = [
  {
    url: 'https://raw.githubusercontent.com/googlefonts/noto-emoji/main/2D/fonts/NotoColorEmoji.ttf',
    dest: 'NotoColorEmoji.ttf',
  },
];

export const targetDir = path.resolve(__dirname, '../../client/public/fonts');

export function downloadFile(url, destPath, redirectCount = 0) {
  if (redirectCount > 5) {
    return Promise.reject(new Error('Too many redirects'));
  }
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https
      .get(url, (response) => {
        // Handle HTTP redirection (e.g. 301, 302 status codes)
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume?.();
          file.close();
          fs.unlink(destPath, () => {}); // Clean up the empty file
          downloadFile(response.headers.location, destPath, redirectCount + 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          response.resume?.();
          file.close();
          fs.unlink(destPath, () => {});
          reject(new Error(`Failed to download: Status ${response.statusCode}`));
          return;
        }

        response.pipe(file);
        file.on('finish', () => {
          file.close(resolve);
        });
      })
      .on('error', (err) => {
        file.close();
        fs.unlink(destPath, () => {}); // Clean up partial file
        reject(err);
      });
  });
}

import { getEventProfile } from '../commandUtils.js';

const repoRoot = path.resolve(__dirname, '../../..');

export function prepareProfile(profileName, opts = {}) {
  const resolvedProfile = profileName || getEventProfile(opts);
  if (opts.dryRun) {
    console.log(`Would prepare profile '${resolvedProfile}' assets and theme.css`);
    return;
  }

  const profileDir = path.resolve(repoRoot, 'profiles', resolvedProfile);
  if (!fs.existsSync(profileDir)) {
    if (process.env.VITEST) return;
    throw new Error(`Event profile '${resolvedProfile}' not found at ${profileDir}`);
  }

  const publicDir = path.resolve(__dirname, '../../client/public');
  fs.mkdirSync(publicDir, { recursive: true });

  const themeSrc = path.join(profileDir, 'theme.css');
  if (fs.existsSync(themeSrc)) {
    fs.copyFileSync(themeSrc, path.join(publicDir, 'theme.css'));
    console.log(`Prepared theme.css for profile '${resolvedProfile}'`);
  }

  const assetsSrc = path.join(profileDir, 'assets');
  if (fs.existsSync(assetsSrc)) {
    try {
      const assetsDest = path.join(publicDir, 'assets');
      fs.mkdirSync(assetsDest, { recursive: true });
      fs.cpSync(assetsSrc, assetsDest, { recursive: true });
      console.log(`Prepared assets for profile '${resolvedProfile}'`);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
}

export async function downloadFonts(opts = {}) {
  prepareProfile(getEventProfile(opts), opts);

  if (opts.dryRun) {
    console.log('Would have downloaded fallback fonts to: ' + targetDir);
    return;
  }

  // Ensure directory exists
  fs.mkdirSync(targetDir, { recursive: true });

  console.log('Checking for font updates...');
  for (const font of FONTS) {
    const destPath = path.join(targetDir, font.dest);
    try {
      await downloadFile(font.url, destPath);
      console.log(`Successfully downloaded/updated ${font.dest}`);
    } catch (err) {
      console.warn(`Could not update ${font.dest} from Google APIs: ${err.message}`);
      if (fs.existsSync(destPath) && fs.statSync(destPath).size > 0) {
        console.log(`Using cached version of ${font.dest}`);
      } else {
        console.error(`Error: Cached version of ${font.dest} not found and download failed.`);
        process.exit(1);
      }
    }
  }
}
