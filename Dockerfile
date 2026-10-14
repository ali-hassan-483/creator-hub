FROM node:20-alpine
WORKDIR /app

RUN apk add --no-cache libc6-compat openssl

COPY package.json ./
RUN npm install

COPY . .
RUN mkdir -p /app/public

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV NODE_OPTIONS="--max-old-space-size=4096"

CMD ["sh", "-c", "npx prisma generate && npm run build && npm run start"]
