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
COPY translation-viewer/ ./translation-viewer/
COPY uploadStatusTracker.js ./
COPY uploadService.js ./

# Set environment variables
ENV PORT=3000
ENV TRANSLATIONS_DIR=/app/translations

# Expose port
EXPOSE 3000

# Start the viewer application
CMD ["node", "translation-viewer/app.js"]
