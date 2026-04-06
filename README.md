# Hermes

A personal AI email agent that lives in Gmail. Built on **Google Apps Script** + **OpenAI** (classification, extraction, reply/briefing HTML). Compiled markdown lives in Google Drive (`raw/`, `wiki/`) for Obsidian and audit trails.

## Quick Start

```bash
# 1. Clone this repo
git clone <your-repo-url> && cd hermes

# 2. Run setup (installs clasp, connects to your Apps Script project)
./setup.sh

# 3. Start coding with auto-deploy
./watch.sh          # auto-pushes to Apps Script on every save

# In another terminal:
cursor .            # or: code . / claude
```

## For AI Agents

- **Cursor**: reads `.cursorrules` automatically
- **Claude Code**: reads `CLAUDE.md` automatically
- **Both**: should read `AGENTS.md` for full architecture

## Files

| File | Purpose |
|---|---|
| `AGENTS.md` | Full agent prompt — architecture, constraints, workflow |
| `schema.md` | Your personal preferences (human-edited, LLM-read) |
| `src/` | Apps Script source files (pushed via clasp) |
| `wiki/` | Compiled knowledge artifacts (LLM-authored) |
| `deploy.sh` | One-command push to Apps Script |
| `watch.sh` | File watcher — auto-pushes on save |
| `setup.sh` | First-time setup |
