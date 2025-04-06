FROM node:18-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY translation-viewer/package*.json ./
RUN npm install

# Copy application files
COPY translation-viewer/ ./

# Create public directory
RUN mkdir -p ./public

# Set environment variables
ENV PORT=3000
ENV TRANSLATIONS_DIR=/app/translations

# Expose the port
EXPOSE 3000

# Start the application
CMD ["node", "app.js"]
