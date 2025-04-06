FROM node:18-alpine

WORKDIR /app

# Copy package files and install dependencies for both applications
COPY package*.json ./
COPY translation-viewer/package*.json ./translation-viewer/
RUN npm install
RUN cd translation-viewer && npm install

# Copy application code
COPY . .

# Create directories for outputs and cache
RUN mkdir -p ./translations ./translation-cache ./logs

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV TRANSLATIONS_DIR=/app/translations

# Expose the port for the viewer
EXPOSE 3000

# The start command will be specified in docker-compose.yml
