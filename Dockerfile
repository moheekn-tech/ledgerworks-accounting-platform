FROM node:22.22.3-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22.22.3-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4310 DATA_DIR=/app/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force && mkdir -p /app/data && chown node:node /app/data
COPY --from=build /app/build ./build
COPY --from=build /app/dist ./dist
COPY --from=build /app/deploy ./deploy
USER node
EXPOSE 4310
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD node -e "fetch('http://127.0.0.1:4310/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","build/server/index.js"]
