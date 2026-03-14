FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY dist/ ./dist/

EXPOSE 8080
ENV PORT=8080

CMD ["node", "dist/index.js"]
