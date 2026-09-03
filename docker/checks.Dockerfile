# Runit's check runner.
#
# Scope: the checks only. `pnpm start` stays on the host, because Metro's file
# watching and pairing a physical iPhone are exactly what a container makes
# painful. Everything in here is pure Node and has no reason to touch the host.
#
# Base is the official Playwright image at the SAME version as this repo's
# @playwright/test pin, so the browser it ships is the browser the harness
# expects and nothing is downloaded at run time.
FROM mcr.microsoft.com/playwright:v1.55.0-noble

# Runs as uid 1000 so anything written back through the bind mount -- dist/,
# design/screenshots/ -- lands on the host owned by you, not by root. The base
# image has no uid 1000, so give it a real home: pnpm, expo and playwright all
# want somewhere writable to cache.
ENV HOME=/home/app \
    CI=1 \
    PNPM_HOME=/home/app/.local/share/pnpm \
    PATH=/home/app/.local/share/pnpm:$PATH

# Both of these must exist HERE, owned by 1000: Docker seeds a fresh named
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
