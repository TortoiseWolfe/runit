# Runit's check runner.
#
# Scope: the checks only. `pnpm start` stays on the host, because native device
# pairing and EAS live outside a container. NOT because file watching or LAN
# networking fail here -- measured on this machine, they don't. See CLAUDE.md.
#
# Base is the official Playwright image at the SAME version as this repo's
# @playwright/test pin, so the browser it ships is the browser the harness
# expects and nothing is downloaded at run time.
FROM mcr.microsoft.com/playwright:v1.55.0-noble

# The image ships its own Node (22.x at the v1.55.0-noble tag) and that is NOT
# the runtime this repo declares. Left alone, the checks run on whatever Node
# Microsoft happened to bundle, drifting from the host every time the Playwright
# tag moves -- which is exactly what happened: checks on v22.18.0, development
# on v24.13.0, and `engines: ">=22"` would have called that compliant.
#
# So the repo picks the Node and the image obeys, not the other way round.
# Keep this version identical to .nvmrc; run-checks.sh asserts they match.
ARG NODE_VERSION=24.13.0
ARG NODE_SHA256=6223aad1a81f9d1e7b682c59d12e2de233f7b4c37475cd40d1c89c42b737ffa8
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    test "$arch" = "amd64" || { echo "NODE_SHA256 pins linux-x64; got $arch" >&2; exit 1; }; \
    curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.gz"; \
    echo "${NODE_SHA256}  node-v${NODE_VERSION}-linux-x64.tar.gz" | sha256sum -c -; \
    tar -xzf "node-v${NODE_VERSION}-linux-x64.tar.gz" -C /usr/local --strip-components=1 \
        --exclude=CHANGELOG.md --exclude=LICENSE --exclude=README.md; \
    rm "node-v${NODE_VERSION}-linux-x64.tar.gz"; \
    # /usr/local/bin precedes /usr/bin, so this shadows the bundled Node.
    node -v; npm -v

# Runs as uid 1000 so anything written back through the bind mount -- dist/,
# design/screenshots/ -- lands on the host owned by you, not by root.
ENV HOME=/home/app \
    CI=1 \
    PNPM_HOME=/home/app/.local/share/pnpm \
    PATH=/home/app/.local/share/pnpm:$PATH

# Both directories must exist HERE, owned by 1000: Docker seeds a fresh named
# volume from whatever the image has at that path, ownership included. Without
# that the volume comes up root-owned and pnpm cannot write into it.
#
# .pnpm-store sits inside /app on purpose. pnpm puts its store beside the
# project so it can hardlink into node_modules, and it will do that whatever we
# configure elsewhere -- pointing a volume at $HOME just left the volume empty
# while pnpm wrote 668MB through the bind mount onto the host. Mounting the
# volume where pnpm already wants to write keeps it off the host entirely.
RUN corepack enable \
 && corepack prepare pnpm@10.33.0 --activate \
 && mkdir -p /home/app/.local/share/pnpm /home/app/.cache \
             /app/node_modules /app/.pnpm-store \
 && chown -R 1000:1000 /home/app /app

WORKDIR /app
USER 1000:1000
