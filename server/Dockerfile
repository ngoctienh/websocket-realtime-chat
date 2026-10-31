FROM node:20-alpine

WORKDIR /app

# Cài đặt dependencies
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

# Sao chép mã nguồn server
COPY src ./src
COPY tests ./tests

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

# Tự động kiểm tra sức khỏe container
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1

USER node

CMD ["node", "src/index.js"]
