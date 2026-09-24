# VeraKey web app + gasless relayer: one Node process serves the built app and /api.
#
#   docker build -t verakey .
#   docker run -p 127.0.0.1:3090:3090 -e VERAKEY_NETWORK=sepolia -e RELAYER_PRIVATE_KEY=0x… -v verakey-data:/data verakey
#
# Publish the port on loopback only and let the proxy reach it: the server trusts one proxy hop for the
# client address (X-Forwarded-For), so a port open to the internet would let clients choose their own.
# The image serves the deployment in deployments/$VERAKEY_NETWORK.json, so build it after
# `scripts/deploy.sh sepolia` has written deployments/sepolia.json. WebAuthn needs https: put the
# container behind exactly one TLS-terminating proxy (a hosting provider's router, Caddy, nginx),
# which is also what the per-IP rate limits trust for the client address.
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN npm install --global pnpm@10.4.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches patches
COPY packages/sdk/package.json packages/sdk/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3090 VERAKEY_NETWORK=sepolia VERAKEY_DATA_DIR=/data
# dist/index.js bundles the relayer with its dependencies (scripts/build-server.mjs): no node_modules.
COPY --from=build /app/dist dist
COPY deployments deployments
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3090
CMD ["node", "dist/index.js"]
