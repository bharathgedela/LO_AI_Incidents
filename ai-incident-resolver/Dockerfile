# Stage 1: Build the React Frontend
FROM node:18-alpine AS frontend-builder
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install
COPY client/ ./
RUN npm run build

# Stage 2: Setup the Node.js Backend
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY server.js ./
COPY --from=frontend-builder /app/client/dist ./client/dist

# Expose the port
EXPOSE 3000

# Start the server
CMD ["node", "server.js"]
