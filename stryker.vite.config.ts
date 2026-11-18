import base from './vite.config.ts';

// Exclude index.test.js during Stryker runs to completely avoid sandbox file path collisions
if (base.test) {
  base.test.reporters = ['default'];
  base.test.exclude = [
    ...(base.test.exclude || [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
    ]),
    'src/server/index.test.js',
    'tests/integration/client-server-route-guard.integration.test.js',
  ];
}

export default base;
