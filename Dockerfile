FROM node:24-alpine
WORKDIR /app
COPY server.mjs package.json .
COPY lib ./lib
COPY public ./public
ENV CACHE_DIR=/data PORT=3000
EXPOSE 3000
CMD ["node", "server.mjs"]
