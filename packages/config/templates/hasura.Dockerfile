# syntax=docker/dockerfile:1

# Hasura's CLI with this repository's schema inside it, for the one-shot `migrate` service.
#
# A deployment cannot bind-mount the working tree (Coolify rewrites relative mounts to paths
# that are not the checkout, and Docker answers a missing host path by creating it empty), so
# the migrations and metadata are copied in. The image is built from the same commit as the
# app, so the schema a checkout describes stays the schema production runs.
FROM hasura/graphql-engine:{{hasura_version}}.cli-migrations-v3

WORKDIR /hasura-project
COPY hasura/migrations ./migrations
COPY hasura/metadata ./metadata
RUN printf 'version: 3\nmetadata_directory: metadata\nmigrations_directory: migrations\nseeds_directory: seeds\n' > config.yaml
