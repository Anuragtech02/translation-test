FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Create necessary directories
RUN mkdir -p ./translation-viewer/views
RUN mkdir -p ./translation-viewer/routes
RUN mkdir -p ./translation-viewer/public
RUN mkdir -p ./translations
RUN mkdir -p ./translation-cache

# Copy application files
COPY translation-viewer/app.js ./translation-viewer/
COPY translation-viewer/views/ ./translation-viewer/views/
COPY translation-viewer/routes/ ./translation-viewer/routes/
COPY translation-viewer/public/ ./translation-viewer/public/
COPY translation-viewer/package.json ./translation-viewer/
COPY uploadStatusTracker.js ./
COPY uploadService.js ./

# Create empty upload-status.json file
# RUN echo '{"lastUpdated":"2023-01-01T00:00:00.000Z","currentlyUploading":null,"files":{}}' > upload-status.json

# Set environment variables
ENV PORT=3000
ENV TRANSLATIONS_DIR=/app/translations

# Expose port
EXPOSE 3000

# Start the viewer application
CMD ["node", "translation-viewer/app.js"]
