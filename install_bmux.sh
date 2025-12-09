#!/bin/bash

# BMUX Helper Script for Linux
# Identifies installed browsers and launches them with the BMUX extension loaded (where possible)
# or directs the user to the installation page.

# ANSI Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== BMUX Extension Loader ===${NC}"

# Get absolute path of the extension directory (current dir)
EXT_DIR="$(dirname "$(realpath "$0")")"
echo -e "Extension Directory: ${GREEN}$EXT_DIR${NC}\n"

# Define common browser binaries
declare -A BROWSERS
BROWSERS["Google Chrome"]="google-chrome"
BROWSERS["Chromium"]="chromium"
BROWSERS["Microsoft Edge"]="microsoft-edge-stable"
BROWSERS["Mozilla Firefox"]="firefox"
BROWSERS["Brave"]="brave-browser"

# Find installed browsers
INSTALLED_KEYS=()
INSTALLED_BINS=()
INDEX=1

echo "Scanning for browsers..."
for NAME in "${!BROWSERS[@]}"; do
    BIN="${BROWSERS[$NAME]}"
    if command -v "$BIN" &> /dev/null; then
        echo -e "  [$INDEX] $NAME (${GREEN}Found${NC})"
        INSTALLED_KEYS+=("$NAME")
        INSTALLED_BINS+=("$BIN")
        ((INDEX++))
    fi
done

if [ ${#INSTALLED_KEYS[@]} -eq 0 ]; then
    echo -e "${RED}No supported browsers found in standard paths.${NC}"
    exit 1
fi

echo ""
read -p "Select a browser to launch BMUX (1-${#INSTALLED_KEYS[@]}): " CHOICE

# Validate input
if ! [[ "$CHOICE" =~ ^[0-9]+$ ]] || [ "$CHOICE" -lt 1 ] || [ "$CHOICE" -gt ${#INSTALLED_KEYS[@]} ]; then
    echo -e "${RED}Invalid selection.${NC}"
    exit 1
fi

# Adjust for 0-based array
IDX=$((CHOICE-1))
SELECTED_NAME="${INSTALLED_KEYS[$IDX]}"
SELECTED_BIN="${INSTALLED_BINS[$IDX]}"

echo -e "\n${BLUE}Launching $SELECTED_NAME...${NC}"

# Launch logic
if [[ "$SELECTED_NAME" == *"Firefox"* ]]; then
    echo -e "For Firefox, automatic loading of unpacked extensions requires 'web-ext'."
    echo -e "Opening ${GREEN}about:debugging${NC} for manual loading..."
    "$SELECTED_BIN" --new-tab "about:debugging#/runtime/this-firefox" &
    echo -e "1. Click 'Load Temporary Add-on'"
    echo -e "2. Select this file: ${GREEN}$EXT_DIR/manifest.json${NC}"
else
    # Chromium-based (Chrome, Edge, Brave, Chromium)
    # Warning: Asking user to close existing instances is often needed for the flag to take effect perfectly,
    # but we'll try launching a new instance/window.
    echo -e "Loading unpacked extension from: $EXT_DIR"
    "$SELECTED_BIN" --load-extension="$EXT_DIR" &
fi

exit 0
