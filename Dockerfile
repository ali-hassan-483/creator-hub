FROM node:20-slim
WORKDIR /app

# Install system dependencies + Python + pip + ffmpeg + yt-dlp + fonts
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    ffmpeg \
    python3 \
    python3-pip \
    python3-venv \
    yt-dlp \
    fontconfig \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# Install OpenAI Whisper (base model ~150MB, fast on CPU for short clips)
RUN pip3 install --no-cache-dir --break-system-packages openai-whisper

COPY package.json ./
RUN npm install

COPY . .
RUN mkdir -p /app/public /usr/share/fonts/truetype/custom && \
    (cp /app/public/fonts/*.ttf /usr/share/fonts/truetype/custom/ 2>/dev/null || true) && \
    fc-cache -f

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV NODE_OPTIONS="--max-old-space-size=4096"

CMD ["sh", "-c", "npx prisma generate && npm run build && npm run start"]
