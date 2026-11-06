# 인터넷 서버에서 머니를 돌리기 위한 설명서 (서비스가 자동으로 읽어요)
FROM node:22-slim
ENV NODE_ENV=production
# 기록이 저장될 곳: 서비스의 '디스크(저장 공간)'를 /data 에 연결해야 기록이 안 사라져요
ENV DATA_DIR=/data
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p /data
EXPOSE 3000
CMD ["node", "money-server.js"]
