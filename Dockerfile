FROM node:22-alpine
WORKDIR /app
COPY package.json server.js engine.js config.default.json ./
COPY public ./public
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s CMD wget -qO- http://127.0.0.1:3000/zdrowie || exit 1
CMD ["node", "server.js"]
