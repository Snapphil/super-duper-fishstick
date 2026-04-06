#!/bin/bash
# deploy.sh — Push local files to Google Apps Script via clasp

echo "📤 Pushing to Apps Script..."
clasp push

if [ $? -eq 0 ]; then
  echo "✅ Deployed successfully at $(date '+%H:%M:%S')"
else
  echo "❌ Push failed. Run 'clasp login' if auth expired."
  exit 1
fi
