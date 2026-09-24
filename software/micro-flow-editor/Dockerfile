# Development-mode image: runs the Vite dev server (packages/app) with hot reload.
# Source code is bind-mounted at runtime (see compose.yaml); the COPY below only
# seeds the image so `docker compose up` works before you've mounted anything, and
# so `npm install` can be cached in its own layer, keyed on package.json files only.
FROM node:24.19.0-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/app/package.json packages/app/package.json
COPY packages/capability-marketplace/package.json packages/capability-marketplace/package.json
COPY packages/catalog-model/package.json packages/catalog-model/package.json
COPY packages/config-compiler/package.json packages/config-compiler/package.json
COPY packages/config-decompiler/package.json packages/config-decompiler/package.json
COPY packages/config-deployment/package.json packages/config-deployment/package.json
COPY packages/core-actions/package.json packages/core-actions/package.json
COPY packages/core-admin/package.json packages/core-admin/package.json
COPY packages/core-session/package.json packages/core-session/package.json
COPY packages/core-status/package.json packages/core-status/package.json
COPY packages/device-processing-graph-model/package.json packages/device-processing-graph-model/package.json
COPY packages/device-profile-authoring-model/package.json packages/device-profile-authoring-model/package.json
COPY packages/device-profile-install/package.json packages/device-profile-install/package.json
COPY packages/device-profile-package/package.json packages/device-profile-package/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/editor-model/package.json packages/editor-model/package.json
COPY packages/node-red-deploy/package.json packages/node-red-deploy/package.json
COPY packages/node-red-nodes/package.json packages/node-red-nodes/package.json
COPY packages/ota-lifecycle/package.json packages/ota-lifecycle/package.json
COPY packages/ota-preflight/package.json packages/ota-preflight/package.json
COPY packages/physical-composition-model/package.json packages/physical-composition-model/package.json
COPY packages/processing-block-catalog/package.json packages/processing-block-catalog/package.json
COPY packages/project-store/package.json packages/project-store/package.json
COPY packages/protocol-sdk/package.json packages/protocol-sdk/package.json
COPY packages/react-flow-adapter/package.json packages/react-flow-adapter/package.json
COPY packages/security-recovery/package.json packages/security-recovery/package.json
COPY packages/system-automation-graph/package.json packages/system-automation-graph/package.json
COPY packages/telemetry-buffer/package.json packages/telemetry-buffer/package.json
RUN npm install

COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev"]
