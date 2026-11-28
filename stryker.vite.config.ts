import base from './vite.config.ts';

// Exclude index.test.js during Stryker runs to completely avoid sandbox file path collisions
const strykerExclude = [
  '**/node_modules/**',
  '**/dist/**',
  '**/cypress/**',
  '**/.{idea,git,cache,output,temp}/**',
  '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
  'src/server/index.test.js',
  'tests/integration/client-server-route-guard.integration.test.js',
];

if (base.test) {
  base.test.reporters = ['default'];
  // Include/exclude are defined per inline project (see vite.config.ts), so the
  // exclusions must be applied to each project rather than the root test config.
  for (const project of base.test.projects ?? []) {
    if (typeof project === 'object' && project !== null && 'test' in project && project.test) {
      project.test.exclude = strykerExclude;
    }
  }
}

export default base;
