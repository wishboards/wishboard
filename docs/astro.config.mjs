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
	if (pkg.repository && pkg.repository.url) {
		githubUrl = pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, '');
	}
} catch (e) {
	// Fallback
}
if (process.env.GITHUB_REPOSITORY) {
	githubUrl = `https://github.com/${process.env.GITHUB_REPOSITORY}`;
}

export default defineConfig({
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
				}
			],
		}),
	],
});
