# Browser dependencies are supplied by the matching Playwright image.
FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=npm_ca \
    if [ -f /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; \
    npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=npm_ca \
    if [ -f /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; \
    npm ci --omit=dev

# Assemble one runtime tree to avoid copying the large browser base per artifact.
FROM dependencies AS artifact
COPY --from=build /app/dist ./dist
RUN mkdir -p /runtime/app /runtime/usr/local/bin \
    && cp /usr/local/bin/node /runtime/usr/local/bin/node \
    && cp -a package.json node_modules dist /runtime/app/

FROM mcr.microsoft.com/playwright:v1.63.0-noble AS runtime
ENV NODE_ENV=production
ENV TRANSPORT=stdio
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
# Preserve Node 24 and copy application artifacts in a single filesystem layer.
COPY --from=artifact /runtime/ /
WORKDIR /app
USER pwuser
# Internal browser proxy binds only to loopback; no remote MCP port is exposed.
ENTRYPOINT ["/usr/local/bin/node", "dist/index.js"]
