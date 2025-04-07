# translation-viewer/Dockerfile

FROM node:18-alpine

WORKDIR /app

# Copy root package files (assuming viewer deps like ejs, express are included)
COPY package*.json ./

# Install dependencies based on root package.json
RUN npm install

# --- Create directories needed by the viewer ---
RUN mkdir -p ./translation-viewer/views
RUN mkdir -p ./translation-viewer/routes
RUN mkdir -p ./translation-viewer/public # For potential future CSS/JS

# --- Copy required modules from root ---
# Adjust paths if your db/statusManager are located differently
COPY db.js ./
COPY statusManager.js ./

# --- Copy viewer-specific application files ---
COPY translation-viewer/app.js ./translation-viewer/
COPY translation-viewer/routes/ ./translation-viewer/routes/
COPY translation-viewer/views/ ./translation-viewer/views/
COPY translation-viewer/public/ ./translation-viewer/public/

# --- NO JSON file creation needed ---

# Environment variables will be set via docker-compose
ENV PORT=3000
ENV NODE_ENV=production

# Expose port
EXPOSE 3000

# Start the viewer application
CMD ["node", "translation-viewer/app.js"]
