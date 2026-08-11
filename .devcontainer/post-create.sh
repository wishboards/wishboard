#!/usr/bin/env bash
# Provision the dev container: dependencies, Playwright browsers, git hooks.
#
# Runs once on container create. Safe to re-run by hand:
#   bash .devcontainer/post-create.sh
set -euo pipefail

# The node_modules named volumes are created root-owned, so npm cannot write to
# them as the `node` user until they are chowned. Harmless if already correct.
for dir in node_modules docs/node_modules; do
  if [[ -d "$dir" && ! -w "$dir" ]]; then
    echo "==> Taking ownership of $dir"
    sudo chown "$(id -u):$(id -g)" "$dir"
  fi
done

echo "==> Installing root dependencies"
# Not --ignore-scripts: the "prepare" script is what installs the Husky hooks,
# and having pre-commit/pre-push actually run locally is a goal of this container.
npm ci

echo "==> Installing docs (Starlight) dependencies"
npm ci --prefix docs --ignore-scripts

echo "==> Installing Playwright browsers"
# From the repo's own @playwright/test, so versions match package.json. OS-level
# dependencies are already baked into the image. playwright.config.ts defines
# chromium, firefox and webkit projects, so install all three or `npm run
# test:e2e` fails on the missing ones.
npx playwright install chromium firefox webkit

echo
echo "==> Verifying the toolchain"
printf '    node      %s\n' "$(node --version)"
printf '    npm       %s\n' "$(npm --version)"
printf '    gh        %s\n' "$(gh --version | head -1 | awk '{print $3}')"
printf '    aws       %s\n' "$(aws --version 2>&1 | awk '{print $1}')"
printf '    gitleaks  %s\n' "$(gitleaks version 2>&1 | tail -1)"
printf '    hooks     %s\n' "$(git config core.hooksPath || echo 'not set')"

cat <<'EOF'

Ready. The checks CI runs, runnable locally:

  npm run lint                 eslint
  npm run format:check         prettier
  npm run type-check           tsc
  npm test                     vitest unit + integration
  npm run test:e2e             playwright
  gitleaks detect              secret scan

  npm run dev                  app on :3000
  npm --prefix docs run dev    Starlight docs on :4321
  npm --prefix docs run build  docs build (verifies Astro base/frontmatter)

Mutation testing is deliberately NOT part of this list: a full Stryker run takes
2.5-5 hours. It runs nightly in CI. See AGENTS.md section 4.
EOF
