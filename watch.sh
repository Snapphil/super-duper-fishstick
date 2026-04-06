#!/bin/bash
# watch.sh — Watches for local file changes and auto-pushes to Apps Script
#
# Dependencies:
#   macOS:  brew install fswatch
#   Linux:  sudo apt install inotify-tools
#
# Usage: ./watch.sh

WATCH_DIR="./src"
COOLDOWN=3  # seconds to wait before pushing (debounce rapid saves)
LAST_PUSH=0

echo "👁️  Hermes watcher active — monitoring $WATCH_DIR"
echo "   Every save auto-pushes to Apps Script via clasp"
echo "   Press Ctrl+C to stop"
echo ""

# Detect OS and use appropriate watcher
if command -v fswatch &> /dev/null; then
  # macOS (fswatch)
  fswatch -o "$WATCH_DIR" --include '\.js$' --exclude '.*' | while read -r count; do
    NOW=$(date +%s)
    DIFF=$((NOW - LAST_PUSH))
    if [ $DIFF -ge $COOLDOWN ]; then
      LAST_PUSH=$NOW
      echo ""
      echo "🔄 Change detected at $(date '+%H:%M:%S')"
      
      # Read the changed files to confirm state
      echo "📖 Current source files:"
      for f in src/*.js; do
        lines=$(wc -l < "$f" 2>/dev/null || echo "0")
        echo "   $f ($lines lines)"
      done
      
      # Push
      clasp push
      if [ $? -eq 0 ]; then
        echo "✅ Auto-deployed at $(date '+%H:%M:%S')"
      else
        echo "❌ Push failed"
      fi
    fi
  done

elif command -v inotifywait &> /dev/null; then
  # Linux (inotify-tools)
  while true; do
    inotifywait -q -e modify,create,delete "$WATCH_DIR" --include '\.js$'
    
    sleep $COOLDOWN  # debounce
    
    echo ""
    echo "🔄 Change detected at $(date '+%H:%M:%S')"
    
    echo "📖 Current source files:"
    for f in src/*.js; do
      lines=$(wc -l < "$f" 2>/dev/null || echo "0")
      echo "   $f ($lines lines)"
    done
    
    clasp push
    if [ $? -eq 0 ]; then
      echo "✅ Auto-deployed at $(date '+%H:%M:%S')"
    else
      echo "❌ Push failed"
    fi
  done

else
  echo "❌ No file watcher found."
  echo "   Install one:"
  echo "     macOS:  brew install fswatch"
  echo "     Linux:  sudo apt install inotify-tools"
  echo ""
  echo "   Or use polling mode (slower):"
  
  # Fallback: polling mode
  echo "🔄 Starting polling mode (checks every ${COOLDOWN}s)..."
  
  # Store initial checksums
  LAST_HASH=""
  while true; do
    CURRENT_HASH=$(find src -name "*.js" -exec md5sum {} \; 2>/dev/null || find src -name "*.js" -exec md5 {} \; 2>/dev/null)
    
    if [ "$CURRENT_HASH" != "$LAST_HASH" ] && [ -n "$LAST_HASH" ]; then
      echo ""
      echo "🔄 Change detected at $(date '+%H:%M:%S')"
      clasp push
      if [ $? -eq 0 ]; then
        echo "✅ Auto-deployed at $(date '+%H:%M:%S')"
      else
        echo "❌ Push failed"
      fi
    fi
    
    LAST_HASH="$CURRENT_HASH"
    sleep $COOLDOWN
  done
fi
