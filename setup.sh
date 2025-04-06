#!/bin/bash
# Setup script for Strapi Translation Pipeline

# Color codes for prettier output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}=================================================${NC}"
echo -e "${GREEN}  Setting up Strapi Translation Pipeline Docker  ${NC}"
echo -e "${GREEN}=================================================${NC}"

# Create necessary directories
echo -e "\n${YELLOW}Creating necessary directories...${NC}"
mkdir -p logs translations translation-cache

# Check if .env file exists, if not copy the example
if [ ! -f .env ]; then
  echo -e "\n${YELLOW}Creating .env file from example...${NC}"
  if [ -f .env.example ]; then
    cp .env.example .env
    echo -e "${GREEN}Created .env file. Please edit it with your actual credentials.${NC}"
    echo -e "${YELLOW}You can do this by running: nano .env${NC}"
  else
    echo -e "${RED}Error: .env.example file not found.${NC}"
    exit 1
  fi
fi

# Ensure required files exist
echo -e "\n${YELLOW}Checking for required files...${NC}"
required_files=("Dockerfile" "docker-compose.yml" "package.json" "fetch-translate.js" "strapi-translate.js" "trans_pipeline.js" "translationPipeline.js" "uploadTranslations.js")
missing_files=()

for file in "${required_files[@]}"; do
  if [ ! -f "$file" ]; then
    missing_files+=("$file")
  fi
done

if [ ${#missing_files[@]} -ne 0 ]; then
  echo -e "${RED}Error: The following required files are missing:${NC}"
  for file in "${missing_files[@]}"; do
    echo -e "${RED}- $file${NC}"
  done
  exit 1
fi

echo -e "${GREEN}All required files found.${NC}"

# Check if Docker and Docker Compose are installed
echo -e "\n${YELLOW}Checking for Docker and Docker Compose...${NC}"
if ! command -v docker &> /dev/null; then
  echo -e "${RED}Docker not found. Please install Docker first.${NC}"
  echo -e "${YELLOW}You can install it with: curl -fsSL https://get.docker.com -o get-docker.sh && sh get-docker.sh${NC}"
  exit 1
fi

if ! command -v docker compose &> /dev/null; then
  echo -e "${RED}Docker Compose not found. Please install Docker Compose first.${NC}"
  echo -e "${YELLOW}You can install it with: sudo apt-get install docker-compose-plugin${NC}"
  exit 1
fi

echo -e "${GREEN}Docker and Docker Compose are installed.${NC}"

# Set correct permissions
echo -e "\n${YELLOW}Setting correct permissions...${NC}"
chmod -R 755 .
chmod 644 .env .env.example
chmod 755 *.js
chmod 755 setup.sh

# Build and start the containers
echo -e "\n${YELLOW}Building and starting the containers...${NC}"
docker compose build
if [ $? -ne 0 ]; then
  echo -e "${RED}Error building Docker containers. Please check the logs above.${NC}"
  exit 1
fi

docker compose up -d
if [ $? -ne 0 ]; then
  echo -e "${RED}Error starting Docker containers. Please check the logs above.${NC}"
  exit 1
fi

echo -e "\n${GREEN}=================================================${NC}"
echo -e "${GREEN}  Strapi Translation Pipeline setup complete!   ${NC}"
echo -e "${GREEN}=================================================${NC}"
echo -e "\n${YELLOW}Useful commands:${NC}"
echo -e "  ${GREEN}docker compose logs -f${NC} - View logs in real-time"
echo -e "  ${GREEN}docker compose ps${NC} - Check the status of the containers"
echo -e "  ${GREEN}docker compose stop${NC} - Stop the containers"
echo -e "  ${GREEN}docker compose start${NC} - Start the containers"
echo -e "  ${GREEN}docker compose restart${NC} - Restart the containers"
echo -e "  ${GREEN}docker compose down${NC} - Stop and remove the containers"
echo -e "\n${YELLOW}Don't forget to edit your .env file with the correct credentials!${NC}"
echo -e "${YELLOW}You can do this by running: nano .env${NC}"
