# Node 24 to match the `pages.yml` / `stryker.yml` jobs and the upper end of the
# CI test matrix (22.x, 24.x). Debian-based so Playwright's browser
# dependencies are installable.
FROM mcr.microsoft.com/devcontainers/javascript-node:24-bookworm

# Playwright's OS-level dependencies are the slow part of an e2e setup (a large
# apt install), so bake them into the image layer rather than paying for them on
# every container create. The browsers themselves are installed in
# post-create.sh from the repo's own @playwright/test, so their versions always
# match package.json rather than drifting from a pin here. install-deps is
# stable across minor versions, so a small skew from package.json is harmless.
RUN npx --yes playwright@1.62.0 install-deps \
    && rm -rf /var/lib/apt/lists/* /root/.npm

# gitleaks, so the secret scan that CI runs via gitleaks-action can also be run
# locally before pushing. Architecture-aware: this project also targets arm
# hardware (Raspberry Pi kiosk), and contributors may be on arm64 laptops.
ARG GITLEAKS_VERSION=8.30.1
RUN set -eux; \
    case "$(uname -m)" in \
      x86_64)        gl_arch=x64 ;; \
      aarch64|arm64) gl_arch=arm64 ;; \
      armv7l)        gl_arch=armv7 ;; \
      *) echo "unsupported architecture: $(uname -m)" >&2; exit 1 ;; \
    esac; \
    curl -fsSL "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_${gl_arch}.tar.gz" \
      | tar -xz -C /usr/local/bin gitleaks; \
    chmod +x /usr/local/bin/gitleaks; \
    gitleaks version
