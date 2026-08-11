/* global console */
// Keeps the docs favicon identical to the app's without committing a second copy
// that can silently drift. Runs from the `predev`/`prebuild` npm hooks, and the
// generated file is gitignored.
//
// Not a symlink on purpose: this repo is developed on Windows where
// core.symlinks is false, so a committed symlink checks out as a text file
// containing the target path, which Astro would then publish as the favicon.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '../../src/client/public/favicon.svg');
const destination = resolve(here, '../public/favicon.svg');

mkdirSync(dirname(destination), { recursive: true });
copyFileSync(source, destination);

console.log(`favicon: ${relative(here, source)} -> ${relative(here, destination)}`);
