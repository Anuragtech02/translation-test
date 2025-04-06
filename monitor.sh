#!/bin/bash
# Monitor script for Strapi Translation Pipeline

# Color codes for prettier output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

clear
echo -e "${BLUE}=================================================${NC}"
echo -e "${BLUE}     Strapi Translation Pipeline Monitor         ${NC}"
echo -e "${BLUE}=================================================${NC}"

# Check if Docker and Docker Compose are installed
if ! command -v docker &> /dev/null; then
  echo -e "${RED}Docker not found. Please install Docker first.${NC}"
  exit 1
fi

if ! command -v docker compose &> /dev/null; then
  echo -e "${RED}Docker Compose not found. Please install Docker Compose first.${NC}"
  exit 1
fi

# Function to show container status
show_status() {
  echo -e "\n${YELLOW}Container Status:${NC}"
  docker compose ps

  echo -e "\n${YELLOW}Resource Usage:${NC}"
  docker stats --no-stream $(docker compose ps -q)
}

# Function to show logs
show_logs() {
  local service=$1
  local lines=$2

  if [ -z "$service" ]; then
    echo -e "\n${YELLOW}Recent Logs (all services):${NC}"
    docker compose logs --tail=$lines
  else
    echo -e "\n${YELLOW}Recent Logs ($service):${NC}"
    docker compose logs $service --tail=$lines
  fi
}

# Function to check translation directory
check_translations() {
  echo -e "\n${YELLOW}Translation Files:${NC}"
  find translations -type f -name "*.json" | wc -l | xargs echo "Total JSON files:"

  # Show the most recent files
  echo -e "\n${YELLOW}Most Recent Translation Files:${NC}"
  find translations -type f -name "*.json" -printf "%T@ %T+ %p\n" | sort -nr | head -5 | cut -d' ' -f2-
}

# Main menu
while true; do
  echo -e "\n${BLUE}=== MENU ===${NC}"
  echo -e "1) ${GREEN}Show container status${NC}"
  echo -e "2) ${GREEN}Show logs (all services)${NC}"
  echo -e "3) ${GREEN}Show translation service logs${NC}"
  echo -e "4) ${GREEN}Show upload service logs${NC}"
  echo -e "5) ${GREEN}Check translation files${NC}"
  echo -e "6) ${GREEN}Restart containers${NC}"
  echo -e "7) ${GREEN}Follow logs in real-time${NC}"
  echo -e "8) ${RED}Exit${NC}"

  read -p "Select an option: " option

  case $option in
    1)
      show_status
      ;;
    2)
      show_logs "" 50  # Show last 50 lines for all services
      ;;
    3)
      show_logs "translation-service" 50
      ;;
    4)
      show_logs "upload-service" 50
      ;;
    5)
      check_translations
      ;;
    6)
      echo -e "\n${YELLOW}Restarting containers...${NC}"
      docker compose restart
      echo -e "${GREEN}Containers restarted.${NC}"
      ;;
    7)
      echo -e "\n${YELLOW}Following logs in real-time (press Ctrl+C to exit)...${NC}"
      docker compose logs -f
      ;;
    8)
      echo -e "\n${GREEN}Exiting...${NC}"
      exit 0
      ;;
    *)
      echo -e "\n${RED}Invalid option. Please try again.${NC}"
      ;;
  esac
done
