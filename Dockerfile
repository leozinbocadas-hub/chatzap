FROM node:20-slim

# Instala ffmpeg para processamento de áudio se necessário
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

# O baileys salva a sessão nesta pasta, então é bom criar o volume no EasyPanel apontando para cá
RUN mkdir -p /app/auth_info_baileys

CMD ["node", "index.js"]
