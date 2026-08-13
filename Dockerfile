FROM node:22-alpine
WORKDIR /app
COPY server.mjs .
ENV CACHE_DIR=/data PORT=3000
EXPOSE 3000
CMD ["node", "server.mjs"]
