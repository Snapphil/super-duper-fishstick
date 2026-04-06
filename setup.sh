#!/bin/bash
# setup.sh — First-time setup for Hermes local development
#
# Prerequisites: Node.js installed
#
# Usage: ./setup.sh

echo "⚡ Hermes Local Dev Setup"
echo "========================="
echo ""

# Step 1: Install clasp
echo "1️⃣  Installing clasp..."
npm install -g @google/clasp 2>/dev/null
if ! command -v clasp &> /dev/null; then
  echo "❌ clasp install failed. Make sure Node.js is installed."
  exit 1
fi
echo "   ✅ clasp installed"

# Step 2: Login
echo ""
echo "2️⃣  Logging into Google..."
echo "   A browser window will open. Log in with the Google account"
echo "   that owns your Apps Script project."
clasp login

# Step 3: Check if already cloned
if [ -f ".clasp.json" ]; then
  SCRIPT_ID=$(cat .clasp.json | grep scriptId | cut -d'"' -f4)
  if [ "$SCRIPT_ID" = "PASTE_YOUR_SCRIPT_ID_HERE" ]; then
    echo ""
    echo "3️⃣  Need your Script ID."
    echo "   → Open your Apps Script project"
    echo "   → Click ⚙️ Project Settings"
    echo "   → Copy the Script ID"
    echo ""
    read -p "   Paste Script ID here: " SCRIPT_ID
    
    # Update .clasp.json
    cat > .clasp.json << EOF
{
  "scriptId": "$SCRIPT_ID",
  "rootDir": "./src"
}
EOF
    echo "   ✅ Script ID saved"
  fi
fi

# Step 4: Pull existing files
echo ""
echo "4️⃣  Pulling existing files from Apps Script..."
mkdir -p src
clasp pull
if [ $? -eq 0 ]; then
  echo "   ✅ Files pulled. Current source files:"
  for f in src/*.js; do
    if [ -f "$f" ]; then
      lines=$(wc -l < "$f")
      echo "      $f ($lines lines)"
    fi
  done
else
  echo "   ⚠️  Pull failed or no existing files. Starting fresh."
fi

# Step 5: Make scripts executable
chmod +x deploy.sh watch.sh 2>/dev/null

# Step 6: Install file watcher
echo ""
echo "5️⃣  File watcher setup..."
if [[ "$OSTYPE" == "darwin"* ]]; then
  if ! command -v fswatch &> /dev/null; then
    echo "   Installing fswatch via Homebrew..."
    brew install fswatch 2>/dev/null
  fi
  echo "   ✅ fswatch ready"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
  if ! command -v inotifywait &> /dev/null; then
    echo "   Installing inotify-tools..."
    sudo apt install -y inotify-tools 2>/dev/null
  fi
  echo "   ✅ inotifywait ready"
fi

# Step 7: Git init
echo ""
echo "6️⃣  Git setup..."
if [ ! -d ".git" ]; then
  git init
  echo "src/appsscript.json" > .gitignore  # keep manifest but ignore if needed
  echo "node_modules/" >> .gitignore
  echo ".clasp.json" >> .gitignore  # contains script ID — keep private
  git add -A
  git commit -m "Initial Hermes setup"
  echo "   ✅ Git repo initialized"
else
  echo "   ✅ Git already initialized"
fi

# Done
echo ""
echo "==============================="
echo "✅ Hermes is ready!"
echo ""
echo "Commands:"
echo "  ./deploy.sh     Push local → Apps Script"
echo "  ./watch.sh      Auto-push on every file save"
echo "  clasp open      Open Apps Script editor in browser"
echo "  clasp pull      Pull remote changes → local"
echo ""
echo "Start coding:"
echo "  cursor .        Open in Cursor"
echo "  code .          Open in VS Code"
echo "  claude          Start Claude Code in this directory"
echo ""
echo "The AGENTS.md file contains instructions for AI agents."
echo "The schema.md file contains your personal preferences."
echo "==============================="
