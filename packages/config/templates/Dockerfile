# syntax=docker/dockerfile:1

# The {{name}} app: built once, then served by `next start`.
#
# NEXT_PUBLIC_* values are inlined into the browser bundle by `next build`, so they are build
# arguments, not runtime variables. Nothing else is baked in: every other variable is read as the
# container starts. No secret is ever a build argument, because build arguments are visible in
# the image.

# Pinned to an exact release rather than a floating tag, so a security release reaches the
# deployment when this line moves, and only then. Both stages name the same one.
FROM node:{{node_version}}-alpine AS build
WORKDIR /app

# The same pnpm as package.json's "packageManager", installed with npm so the build never
# downloads a package manager at run time.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack disable && npm install -g --no-update-notifier pnpm@{{pnpm_version}}

# Dependencies first: this layer survives every change that is not to the lockfile.
# --ignore-scripts because a git hook installer wants a checkout, and an image is not one.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .

# What the browser has to be told before it is built.
ARG NEXT_PUBLIC_HASURA_ENDPOINT
ARG NEXT_PUBLIC_SITE_URL

# Modules that check their environment as they are imported need a value while `next build`
# imports them; these placeholders exist for that and for nothing else.
RUN DATABASE_URL="postgres://build:build@127.0.0.1:5432/build" \
  HASURA_GRAPHQL_ADMIN_SECRET="build-only-placeholder" \
  HASURA_JWT_SECRET="build-only-placeholder-of-at-least-32-characters" \
  pnpm build

FROM node:{{node_version}}-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT={{port}}

# pnpm's node_modules is a tree of relative symlinks, which COPY keeps. Owned by the user that
# runs them: next/image writes into .next/cache as it serves.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/deploy ./deploy
COPY --from=build --chown=node:node /app/package.json /app/pnpm-lock.yaml /app/tsconfig.json ./
# The auth config the entrypoint's `better-auth migrate` reads.
COPY --from=build --chown=node:node /app/{{auth_dir}} ./{{auth_dir}}

USER node
EXPOSE {{port}}
ENTRYPOINT ["/bin/sh", "/app/deploy/entrypoint.sh"]
