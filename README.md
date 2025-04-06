# Strapi Translation Pipeline - Docker Setup

This repository contains a Docker-based solution for translating Strapi content into multiple languages using Google's Generative AI, and then uploading the translated content back to Strapi.

## System Overview

The system consists of two main services:

1. **Translation Service**: Fetches content from the source Strapi instance, translates it, and saves the translations to JSON files.
2. **Upload Service**: Takes the translated JSON files and uploads them to the target Strapi instance.

## File Structure

```
strapi-translation-pipeline/
├── .env                     # Environment variables (copy from .env.example)
├── Dockerfile               # Docker image definition
├── docker-compose.yml       # Docker Compose configuration
├── fetch-translate.js       # Main entry script for translation service
├── package.json             # Node.js dependencies
├── strapi-translate.js      # Main translation script (from paste.txt)
├── trans_pipeline.js        # Translation service (from paste-2.txt)
├── translationPipeline.js   # Translation pipeline (from paste-3.txt)
├── uploadTranslations.js    # Upload script (from paste-4.txt)
├── logs/                    # Directory for log files (created automatically)
├── translations/            # Directory for translation output (mounted volume)
└── translation-cache/       # Directory for translation cache (mounted volume)
```

## Setup Instructions

### 1. Prepare Your Environment

First, make sure Docker and Docker Compose are installed on your VPS:

```bash
# Install Docker (if not already installed)
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Install Docker Compose (if not already installed)
sudo apt-get install docker-compose-plugin
```

### 2. Set Up the Project

1. Create a new directory for the project:

```bash
mkdir -p strapi-translation-pipeline
cd strapi-translation-pipeline
```

2. Copy all the project files to this directory (Dockerfile, docker-compose.yml, etc.)

3. Create an `.env` file with your configuration:

```bash
cp .env.example .env
nano .env  # Edit the file with your actual credentials and settings
```

4. Make sure these files are renamed correctly:
   - `strapi-translate.js` (from paste.txt)
   - `trans_pipeline.js` (from paste-2.txt)
   - `translationPipeline.js` (from paste-3.txt)
   - `uploadTranslations.js` (from paste-4.txt)

### 3. Build and Run the Services

```bash
# Build and start the services
docker-compose up -d

# Check the logs
docker-compose logs -f
```

## Configuration Options

Edit the `.env` file to configure the system:

- **SOURCE_URL**: URL of the source Strapi instance
- **SOURCE_TOKEN**: API token for the source Strapi instance
- **TARGET_URL**: URL of the target Strapi instance
- **TARGET_TOKEN**: API token for the target Strapi instance
- **GOOGLE_API_KEY**: Your Google API key for the Generative AI
- **SOURCE_LOCALE**: Source language code (default: en)
- **TARGET_LANGS**: Comma-separated list of target language codes
- **MAX_REPORTS**: Maximum number of reports to fetch and translate
- **RUN_INTERVAL_MS**: How often to run the translation process (in milliseconds)

## Monitoring and Maintenance

### Checking Logs

```bash
# View logs for all services
docker-compose logs

# View logs for a specific service
docker-compose logs translation-service
docker-compose logs upload-service

# Follow logs in real-time
docker-compose logs -f
```

### Managing Services

```bash
# Stop the services
docker-compose stop

# Start the services
docker-compose start

# Restart the services
docker-compose restart

# Stop and remove containers, networks
docker-compose down

# Rebuild and restart services
docker-compose up -d --build
```

### Data Persistence

The system uses Docker volumes to persist data:

- `./translations`: Contains the translated JSON files
- `./translation-cache`: Contains the translation cache

These directories are mounted in both services to ensure data sharing.

## Troubleshooting

- **Services won't start**: Check the logs with `docker-compose logs` to see specific errors.
- **Translation fails**: Make sure your Google API key is valid and has access to the Generative AI API.
- **Upload fails**: Verify that your Strapi tokens have the necessary permissions.
- **Container crashes**: Check the memory usage on your VPS; you might need to allocate more resources.

## Scheduled Operations

The translation service runs on a schedule defined by `RUN_INTERVAL_MS` in the environment variables.
The default is one hour. You can change this value in the `.env` file.
