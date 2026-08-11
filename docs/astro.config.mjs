/* global process, console */
// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Read repository from root package.json
const pkgPath = resolve(process.cwd(), '../package.json');
let githubUrl = 'https://github.com/wishboards/wishboard';
try {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  if (pkg.repository?.url) {
    githubUrl = pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, '');
  }
} catch (e) {
  console.warn('Could not read package.json repository url:', e.message);
}
if (process.env.GITHUB_REPOSITORY) {
  githubUrl = `https://github.com/${process.env.GITHUB_REPOSITORY}`;
}

// GitHub Pages serves a project site from https://<owner>.github.io/<repo>/, so
// Astro needs `base` set to that subpath. Without it every emitted asset and
// internal link is root-absolute (/_astro/..., /favicon.svg) and 404s, which
// renders the site unstyled with dead navigation.
//
// Derived from GITHUB_REPOSITORY so a fork publishes correctly with no edits.
// Override both when serving from a custom domain, where the site lives at the
// domain root: DOCS_SITE=https://docs.example.com DOCS_BASE=/
const [ghOwner, ghRepo] = (process.env.GITHUB_REPOSITORY || '').split('/');
const site = process.env.DOCS_SITE || (ghOwner ? `https://${ghOwner}.github.io` : undefined);
const base = process.env.DOCS_BASE || (ghRepo ? `/${ghRepo}` : undefined);

export default defineConfig({
  site,
  base,
  integrations: [
    starlight({
      title: 'Wishboard Docs',
      social: [{ icon: 'github', label: 'GitHub', href: githubUrl }],
      sidebar: [
        {
          label: 'Core Documentation',
          items: [
            { label: 'Forking & Bootstrapping Guide', slug: 'forking-guide' },
            { label: 'Deployment Guide', slug: 'deployment-guide' },
            { label: 'Event Profiles', slug: 'event-profiles' },
            { label: 'Matching Rules', slug: 'matching-rules' },
            { label: 'Mutation Testing', slug: 'mutation-testing' },
          ],
        },
        {
          label: 'Architecture Decision Records (ADRs)',
          items: [{ autogenerate: { directory: 'adr' } }],
        },
        {
          label: 'Design Documents',
          items: [{ autogenerate: { directory: 'design' } }],
        },
      ],
    }),
  ],
});
