FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy application code
COPY . .

# Create directories for outputs and cache
RUN mkdir -p ./translations ./translation-cache

# Set environment variables
ENV NODE_ENV=production

# Command will be specified in docker-compose.yml
CMD ["node", "index.js"]
