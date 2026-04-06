# Hermes — Illusion System Design

> How to make an email agent that feels like it genuinely understands you.

---

## The Core Problem

An LLM without persistent memory is stateless. Each session reconstructs the world from scratch. Without intervention, Hermes is just a smart-ish email sorter that asks clarifying questions and gives canned responses. The user correctly identified this: it "acts dumb", asks permission at the wrong times, gives robotic emails.

The fix is not to write more code. The fix is to design an **identity system** — a set of interlocking layers that create the *illusion* (and eventually the reality) of a genuinely intelligent, deeply personalized agent.

This document describes that system.

---

## Architecture: The Three-Layer Illusion

```
LAYER 3 — PERSONA
  Who Hermes thinks it is. Rich, stable self-concept injected into every prompt.
  → buildHermesPersonaPrompt_() in ContextEngine.js

LAYER 2 — KNOWLEDGE (wiki)
  What Hermes knows. Compiled from every email. Read on every response.
  → readWikiContext_() injects into ALL handlers, not just email processing.

LAYER 1 — MEMORY (JSON)
  Structured facts: deadlines, people graph, interaction counts, conversation history.
  → getMemoryDigest_() already exists. Must be injected everywhere.
```

The illusion requires all three layers to be present in **every interaction** — not just email processing triggers.

---

## Layer 3: Persona — The Identity Illusion

Hermes needs a stable, confident self-concept. Without it, the LLM defaults to generic assistant behavior: asking permission, hedging, saying "I would be happy to help."

The persona prompt (`buildHermesPersonaPrompt_()`) establishes:

1. **Who Hermes is**: a deeply personal agent, not a generic assistant
2. **Who it serves**: injected from AGENT.md (the user's self-description)
3. **Behavioral rules**: hard constraints against asking unnecessary questions, against canned openers, against permission-seeking
4. **Communication style**: from schema.md, injected verbatim

This prompt is injected as the **system message** in every ORACLE call — not just classification.

### Key Behavioral Rules (hardcoded into persona)

```
1. Never ask permission for actions you can execute directly.
2. Never ask clarifying questions unless the request is genuinely ambiguous.
3. Never say "I would be happy to...", "Certainly!", "Of course!", or any hollow opener.
4. When asked what you know — enumerate it from wiki and memory. Do not be vague.
5. Be direct. Match the sender's energy.
6. You are confident about what you know. Qualify only when genuinely uncertain.
```

---

## Layer 2: Knowledge — The Wiki Illusion

The Karpathy insight (Research.txt) is that the LLM should be a **compiler**, not a search engine. Raw emails → compiled wiki → every response reads from the wiki.

### What Must Change

Previously, wiki was written during `processNewEmails` but **never read during conversation**. This is why "what do you know about me?" got a canned response — Hermes wasn't reading its own knowledge base.

### The Fix

`readWikiContext_()` reads:
- `wiki/index.md` — overview of compiled knowledge
- `wiki/commitments.md` — current commitments (outbound and inbound)
- `wiki/people/*.md` — profiles of recent contacts (up to 6, sorted by last updated)

This is injected into:
- `buildCommandPrompt_()` — command intent parsing
- `handleConversation_()` — conversation replies
- `generateAndSendBriefing_()` — briefing generation

### The Self-Updating Loop

```
Email arrives → processNewEmails → classify → compile wiki
User asks question → handleConversation_ → reads wiki → answers from compiled knowledge
```

The wiki accumulates over time. The longer Hermes runs, the more it knows, the better it answers. This is the compounding property from Research.txt.

---

## Layer 1: Memory — Structured Facts

The JSON-based memory layer (`getMemoryDigest_()`) provides:
- Active deadlines (overdue and upcoming)
- People graph (importance scores, interaction counts, waiting-on flags)
- Active threads (conversations needing replies)
- Recent research insights
- Learning stats (classifications, approvals, rejections)

This was already being injected into `buildCommandPrompt_()`. After the redesign it is also injected into `handleConversation_()`.

---

## Conversation Handling — The Broken Part, Fixed

### Before
```javascript
function handleConversation_(parsed, text, thread) {
  const reply = parsed.conversational_response || 'Got it.';  // ← max 50 words from JSON parsing
  replyInThread_(thread, quickCard_('Hermes', escapeHtml(reply)));
}
```

`conversational_response` is a ≤50 word field in the command-parsing JSON. ORACLE puts a quick phrase there while parsing intent. This was being used as the actual email reply. Hence "Doing well — ready to help."

### After
```javascript
function handleConversation_(parsed, text, thread) {
  // 1. Read wiki (compiled knowledge)
  var wikiCtx = readWikiContext_(6);
  // 2. Read memory (structured facts)
  var memory = getMemoryDigest_();
  // 3. Read schema (communication style)
  var schema = getParsedSchema_();
  // 4. Build full persona system prompt
  var systemPrompt = buildHermesPersonaPrompt_();
  // 5. Call ORACLE with full context → generate real HTML email
  var forgePrompt = buildForgePrompt_('conversation', { message: text }, richInstructions);
  var result = callAgent_('conversational_reply', forgePrompt.userPrompt, forgePrompt.systemPrompt);
  // 6. Send the full HTML email
  replyInThread_(thread, result.text);
}
```

Now "what do you know about me?" gets a real answer drawn from wiki, AGENT.md, and memory.

---

## Draft Email Quality — The Robotic Output Problem

### Root Cause

`queueDraftForApproval_` was calling `buildForgePrompt_('draft_reply', ...)` — a function designed for HTML email layout, not for natural writing. The system prompt for FORGE is about `<table>` structure and inline styles, not about communication quality.

### Fix: Two-Step Generation

1. **Writing pass** (ORACLE): Generate the email body as plain text, with a system prompt focused entirely on natural writing, communication rules, and persona.
2. **Formatting pass** (FORGE): Render the plain text into themed HTML.

The writing prompt explicitly bans clichés, hollow openers, permission language, and length mismatches.

---

## Handler Stubs — What Was Broken

| Handler | Before | After |
|---------|--------|-------|
| `handleConversation_` | Used 50-word JSON field | Full ORACLE call with wiki+memory |
| `handleScheduleChange_` | "Edit preferences.json in Drive" | Parses intent → writes preferences.json |
| `handlePreference_` | "Edit preferences.json in Drive" | Parses intent → writes preferences.json |
| `handleCompose_` | "Not yet implemented" | Generates draft, queues for approval |
| `handleEdit_` | "Reject and re-compose" | Re-generates with edit instructions |

---

## Command Routing — What Triggers What

```
User email with [Hermes] subject
  → checkForCommands()
    → fetchUserCommands_()
    → quickParseCommand_()  ← handles simple patterns without LLM
      → brief_me → handleBriefMe_()  ← sends briefing email
      → status → handleStatus_()
      → pause/resume → handlePause_/handleResume_()
    → parseCommandWithOpenAI_()  ← ORACLE parses complex commands
      → conversation → handleConversation_()  ← NOW uses full wiki+memory
      → schedule_change → handleScheduleChange_()  ← NOW writes to Drive
      → preference → handlePreference_()  ← NOW writes to Drive
      → compose → handleCompose_()  ← NOW generates real draft
      → research → handleResearch_()  ← multi-step Gmail search + synthesis
      → query → handleQuery_()  ← same as research
```

---

## What "Brief Me" Should Do

`brief me` → `quickParseCommand_` → `brief_me` → `handleBriefMe_()` → `generateAndSendBriefing_()` → sends a new Hermes email.

This already worked. The user's screenshot showed the **conversation reply** (from "how are you? what do you know about me?") getting the canned response — not the briefing itself.

---

## Self-Evolution Path

The agent gets smarter in two ways:

### 1. Passive — Wiki Accumulation
Every email processed → people profiles updated → commitments extracted → wiki grows. The agent's knowledge compounds automatically without any user intervention.

### 2. Active — Feedback Learning
When the user edits or rejects a draft, `learning.total_edits` and `learning.total_rejections` increment. These stats are already tracked. Future enhancement: use rejection patterns to update communication style rules automatically.

### 3. Schema Evolution (Future)
The schema.md is currently human-edited only. Future: when the user sends a preference command ("never use bullet points"), Hermes could propose a schema.md diff for the user to approve, then apply it.

---

## AGENT.md — The Missing Piece

`AGENT.md` in Drive is the user's self-description. It should contain:
- Name, role, context
- Key relationships
- Current projects and priorities
- Communication preferences

If this file is sparsely populated, Hermes has less to work with. The cold start process creates it with a template, but the user must fill it in for the illusion to be complete.

This is the highest-leverage action a user can take to improve Hermes.

---

## Summary: What Was Wrong, What Changed

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| Canned "Doing well" response | `handleConversation_` used 50-word JSON field | Full ORACLE call with wiki + memory + persona |
| Doesn't know anything about user | Wiki never read during conversation | `readWikiContext_()` injected into all handlers |
| Robotic draft emails | FORGE prompt is about HTML layout, not writing | Two-step: writing pass → formatting pass |
| Asks permission/says "edit Drive" | Handlers were stubs | Implemented: schedule, preference, compose, edit |
| Doesn't update wiki during conversation | Wiki only updated in `processNewEmails` | Now injected + conversation context stored |
| Unnecessary questions | LLM defaulted to generic assistant behavior | Persona prompt with hard behavioral rules |

---

*Compiled April 2026 — Hermes v3.1 Architecture*
