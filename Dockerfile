FROM node:24-bookworm-slim

WORKDIR /app
COPY --chown=node:node package.json server.mjs ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
RUN mkdir /app/.data && chown node:node /app/.data

ENV HOST=0.0.0.0
ENV PORT=3000
USER node
VOLUME ["/app/.data"]
EXPOSE 3000
CMD ["node", "server.mjs"]
