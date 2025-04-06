FROM node:18-alpine

WORKDIR /app

# Create necessary directories
RUN mkdir -p ./translations ./translation-cache ./logs

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy application code
COPY . .

# Create translation-viewer directory structure
RUN mkdir -p ./translation-viewer/views
RUN mkdir -p ./translation-viewer/routes
RUN mkdir -p ./translation-viewer/public

# Set environment variables
ENV NODE_ENV=production
ENV OUTPUT_DIR=/app/translations
ENV CACHE_DIR=/app/translation-cache
ENV TRANSLATIONS_DIR=/app/translations

# Volume mounts
VOLUME ["/app/translations", "/app/translation-cache", "/app/logs"]

# Expose the viewer port
EXPOSE 3000

# Command will be specified in docker-compose.yml
CMD ["node", "fetch-translate.js"]
