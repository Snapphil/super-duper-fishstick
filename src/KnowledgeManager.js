/**
 * HERMES — KnowledgeManager.gs
 * ============================================
 * PANTHEON SYSTEM: Unified Brain & Decision Engine
 *
 * Single responsibility: maintain wiki/context.md as the live working
 * memory of the agent, detect knowledge gaps, and fill them (from email
 * search or by asking the user directly — never both at once, and never
 * more than once per week per topic).
 *
 * Every significant agent action reads loadAgentContext_() first.
 * Every email batch or conversation updates context.md afterward.
 *
 * Drive layout (what this file cares about):
 *   wiki/
 *     context.md       ← THE BRAIN (always current, always injected)
 *     AGENT.md         ← who the user is (canonical copy in wiki)
 *     index.md         ← wiki table of contents
 *     commitments.md   ← tracked commitments
 *     research-log.md  ← autonomous task history
 *     people/*.md      ← contact profiles
 *     projects/*.md    ← project pages (future)
 */

// ============ PRIMARY ENTRY POINT ============

/**
 * Read everything the agent needs to think.
 * Fast path: context.md (~300 tokens). Deep path: +people profiles.
 *
 * @param {'fast'|'full'} depth
 * @returns {string} ready-to-inject context block
 */
function loadAgentContext_(depth) {
  depth = depth || 'fast';
  var parts = [];

  // 1. context.md — the condensed brain (always read)
  var ctx = readWikiFile_('context.md');
  if (ctx && ctx.trim().length > 20) {
    parts.push('[ LIVE CONTEXT ]\n' + truncate(ctx, 1200));
  } else {
    // No context.md yet — fall back to inline memory
    var mem = getMemoryDigest_();
    parts.push('[ MEMORY DIGEST ]\n' + truncate(mem.full, 1200));
  }

  // 2. AGENT.md — who we're serving (always read, compact)
  var agentMd = getWikiAgentMd_();
  if (agentMd) parts.push('[ AGENT PROFILE ]\n' + truncate(agentMd, 600));

  // 3. Schema communication style
  var schema = getParsedSchema_();
  if (schema.communicationStyle) {
    parts.push('[ COMM STYLE ]\n' + truncate(schema.communicationStyle, 300));
  }

  if (depth === 'full') {
    // 4. Recent people profiles (top 4 by last updated)
    try {
      var wikiFolder = getWikiFolder_();
      if (wikiFolder) {
        var pf = wikiFolder.getFoldersByName('people');
        if (pf.hasNext()) {
          var pfFolder = pf.next();
          var files = pfFolder.getFiles();
          var peopleFiles = [];
          while (files.hasNext()) peopleFiles.push(files.next());
          peopleFiles.sort(function(a, b) {
            return b.getLastUpdated().getTime() - a.getLastUpdated().getTime();
          });
          peopleFiles.slice(0, 4).forEach(function(f) {
            try {
              var content = f.getBlob().getDataAsString();
              parts.push('[ PERSON: ' + f.getName().replace('.md','').toUpperCase() + ' ]\n' + truncate(content, 500));
            } catch (e) {}
          });
        }
      }
    } catch (e) { Logger.log('[WARN] loadAgentContext_ people: ' + e.message); }

    // 5. Commitments
    var cmt = readWikiFile_('commitments.md');
    if (cmt) parts.push('[ COMMITMENTS ]\n' + truncate(cmt, 600));

    // 6. Research log (last 15 lines)
    var rlog = getRecentResearchLog_(15);
    if (rlog && rlog !== '(No research log yet)') {
      parts.push('[ RESEARCH LOG ]\n' + rlog);
    }
  }

  return parts.join('\n\n') || '(No context compiled yet)';
}

// ============ CONTEXT.MD MAINTENANCE ============

/**
 * Rebuild wiki/context.md from current state.
 * Call after every email batch and after conversations.
 * Keeps the brain always current without reading many files.
 */
function updateContextMd_() {
  try {
    var memory = getMemoryDigest_();
    var now = new Date();
    var today = todayStr_();
    var agentMd = getWikiAgentMd_() || getAgentMd_();

    // Active threads needing attention
    var activeThreads = getActiveThreads_();
    var pending = getAllPendingApprovals_();

    var threadLines = activeThreads
      .filter(function(t) { return t.needs_action; })
      .slice(0, 8)
      .map(function(t) {
        return '- [' + (t.status || 'open') + '] ' + truncate(t.subject || '(no subject)', 60) +
          (t.participants ? ' — ' + t.participants.join(', ') : '');
      }).join('\n') || '(none)';

    // Upcoming deadlines
    var upcoming = (memory.structured.upcoming || []).slice(0, 5);
    var deadlineLines = upcoming.length
      ? upcoming.map(function(d) {
          return '- ' + d.date + ': ' + truncate(d.description || '', 60);
        }).join('\n')
      : '(none)';

    // Who we're waiting on
    var waitingLines = (memory.structured.waitingOn || []).slice(0, 5)
      .map(function(p) { return '- ' + p.name + ': ' + (p.waiting_on || '?'); })
      .join('\n') || '(none)';

    // Top contacts
    var topPeople = (memory.structured.people || []).slice(0, 8)
      .map(function(p) {
        return p.name + ' (' + p.email + ') imp:' + p.importance;
      }).join(', ') || '(none tracked)';

    // Knowledge gaps (what we don't know yet)
    var gaps = readKnowledgeGaps_();

    var content = [
      '# Hermes — Live Context',
      '*Updated: ' + now.toISOString() + ' by Hermes*',
      '',
      '## Who You Are (condensed)',
      truncate(agentMd, 400),
      '',
      '## Active Threads',
      threadLines,
      '',
      '## Upcoming Deadlines',
      deadlineLines,
      '',
      '## Waiting On',
      waitingLines,
      '',
      '## Pending Approvals',
      pending.length > 0
        ? pending.map(function(p) { return '- #? [' + p.type + '] ' + truncate(p.subject || '', 60); }).join('\n')
        : '(none)',
      '',
      '## Known Contacts',
      topPeople,
      '',
      '## Knowledge Gaps',
      gaps || '(none identified)',
      '',
      '---',
      '*Hermes reads this before every response. Edit to correct mistakes.*'
    ].join('\n');

    writeWikiFile_('context.md', content);
    Logger.log('[KM] context.md updated.');
  } catch (e) {
    Logger.log('[WARN] updateContextMd_ failed: ' + e.message);
  }
}

// ============ KNOWLEDGE GAP DETECTION ============

/**
 * Ask ORACLE to identify what it needs to know to serve the user well
 * but doesn't currently know. Returns a short gap list.
 * Only runs during proactive tasks (not on every email).
 */
function detectAndFillKnowledgeGaps_() {
  var today = todayStr_();
  var ctx = loadAgentContext_('fast');
  var schema = readSchemaMd_() || '';

  var systemPrompt = [
    'You are Hermes reviewing your own knowledge base to find gaps.',
    'Your goal: identify what you need to know to serve this user well,',
    'but don\'t currently have in your context.',
    '',
    'Return JSON: {',
    '  "gaps": [',
    '    {"topic": "short label", "why_needed": "brief reason",',
    '     "fill_method": "email_search|ask_user",',
    '     "search_query": "Gmail query if email_search, else null",',
    '     "question": "exact question to ask user if ask_user, else null"}',
    '  ]',
    '}'
  ].join('\n');

  var userPrompt = [
    'CURRENT CONTEXT:',
    truncate(ctx, 1500),
    '',
    'SCHEMA:',
    truncate(schema, 400),
    '',
    'What 1-3 things would help you serve this user better that you don\'t know yet?',
    'Only list gaps that are genuinely actionable and specific.',
    'Prefer email_search over ask_user (don\'t bother the user unless truly necessary).'
  ].join('\n');

  var result;
  try {
    result = callOracleJson_('research_synthesis', userPrompt, systemPrompt);
  } catch (e) {
    Logger.log('[WARN] detectKnowledgeGaps_ ORACLE failed: ' + e.message);
    return;
  }

  var gaps = Array.isArray(result.gaps) ? result.gaps : [];
  if (gaps.length === 0) return;

  var filled = [];
  var toAsk = [];

  for (var i = 0; i < gaps.length; i++) {
    var gap = gaps[i];
    if (!gap || !gap.topic) continue;

    if (gap.fill_method === 'email_search' && gap.search_query) {
      // Fill from email search
      try {
        var emails = searchEmails_(gap.search_query, 15);
        if (emails.length > 0) {
          var summary = synthesizeGapFromEmails_(gap.topic, gap.why_needed, emails);
          if (summary) {
            appendToContextGap_(gap.topic, summary);
            filled.push(gap.topic + ': found from emails');
          }
        }
      } catch (e) {
        Logger.log('[WARN] Gap fill search failed for ' + gap.topic + ': ' + e.message);
      }
    } else if (gap.fill_method === 'ask_user' && gap.question) {
      toAsk.push(gap);
    }
  }

  // Ask user at most one question, and not more than once per week
  if (toAsk.length > 0) {
    var lastAsk = getProp('LAST_USER_QUESTION_AT');
    var daysSinceAsk = lastAsk
      ? Math.floor((Date.now() - new Date(lastAsk).getTime()) / 86400000)
      : 999;

    if (daysSinceAsk >= 7) {
      var topQuestion = toAsk[0];
      askUserForContext_(topQuestion.topic, topQuestion.question, topQuestion.why_needed);
      setProp('LAST_USER_QUESTION_AT', new Date().toISOString());
      setProp('LAST_USER_QUESTION_TOPIC', topQuestion.topic);
      filled.push('Asked user about: ' + topQuestion.topic);
    }
  }

  // Update the gaps list in context.md
  if (gaps.length > 0) {
    var gapLines = gaps.map(function(g) {
      return '- ' + g.topic + ' (' + g.fill_method + ')';
    }).join('\n');
    saveKnowledgeGaps_(gapLines);
  }

  // Log the gap detection run
  appendResearchLog_([today + ' | gap_detection | ' +
    gaps.length + ' gaps found | ' + filled.join(', ')]);

  return { gaps: gaps, filled: filled };
}

/**
 * Use ORACLE to synthesize an email search result into a concise fact.
 * @private
 */
function synthesizeGapFromEmails_(topic, reason, emails) {
  var emailSnippets = emails.slice(0, 8).map(function(e) {
    return 'From: ' + e.from + ' | Subject: ' + e.subject + ' | ' + truncate(e.body || e.snippet || '', 200);
  }).join('\n---\n');

  try {
    var result = callAgent_('research_synthesis',
      'Topic: ' + topic + '\nReason needed: ' + reason + '\n\nEmails:\n' + truncate(emailSnippets, 2000) + '\n\nSummarize what these emails reveal about this topic in 1-3 sentences.',
      'You are extracting a specific fact from emails. Be concise and specific.',
      { temperature: 0.1, maxTokens: 256 });
    return result.text || null;
  } catch (e) {
    return null;
  }
}

/**
 * Send a single targeted question to the user.
 * @private
 */
function askUserForContext_(topic, question, reason) {
  var t = getTheme();
  var body = quickCard_(
    'Quick question — ' + topic,
    '<p style="font-family:' + t.font + ';color:' + t.text + ';">' +
    escapeHtml(question) + '</p>' +
    '<p style="font-family:' + t.font + ';color:' + t.textMuted + ';font-size:12px;">' +
    'This helps me: ' + escapeHtml(reason || 'serve you better') + '</p>' +
    '<p style="font-family:' + t.font + ';color:' + t.textMuted + ';font-size:11px;">' +
    'Reply directly to answer. I\'ll update my memory and won\'t ask again.</p>'
  );
  sendHermesEmail_('Context question: ' + topic, body);
  Logger.log('[KM] Asked user about: ' + topic);
}

// ============ KNOWLEDGE GAPS PERSISTENCE ============

function readKnowledgeGaps_() {
  return getProp('KNOWLEDGE_GAPS') || '';
}

function saveKnowledgeGaps_(gapText) {
  setProp('KNOWLEDGE_GAPS', truncate(gapText || '', 800));
}

function appendToContextGap_(topic, finding) {
  var existing = getProp('CONTEXT_FINDINGS') || '';
  var line = todayStr_() + ' | ' + topic + ': ' + truncate(finding, 200);
  var lines = existing ? existing.split('|||') : [];
  lines.push(line);
  if (lines.length > 20) lines = lines.slice(-20);
  setProp('CONTEXT_FINDINGS', lines.join('|||'));
}

// ============ AGENT.MD IN WIKI ============

/**
 * Read AGENT.md from wiki/ if it exists there, else fall back to root.
 * The wiki copy is the canonical copy going forward.
 */
function getWikiAgentMd_() {
  try {
    var wikiCopy = readWikiFile_('AGENT.md');
    if (wikiCopy && wikiCopy.trim().length > 20) return wikiCopy;
  } catch (e) {}
  return getAgentMd_(); // fall back to legacy location
}

/**
 * Write AGENT.md to both the wiki copy and the registered file (for backward compat).
 */
function saveAgentMd_(content) {
  // Write to wiki/AGENT.md (primary)
  try {
    writeWikiFile_('AGENT.md', content);
  } catch (e) {
    Logger.log('[WARN] Could not write wiki/AGENT.md: ' + e.message);
  }
  // Write to registered file (backward compat)
  try {
    writeMemory('FILE_AGENT_MD', content);
  } catch (e) {
    Logger.log('[WARN] Could not write FILE_AGENT_MD: ' + e.message);
  }
}

// ============ DRIVE LAYOUT MANIFEST ============

/**
 * Return a human-readable map of what's in Drive and why.
 * Used in status emails and for debugging.
 */
function getDriveLayoutManifest_() {
  return [
    '# Hermes Drive Layout',
    '',
    '## wiki/  — THE BRAIN (all .md, LLM reads/writes)',
    '  context.md         ← live working memory, rebuilt every email run',
    '  AGENT.md           ← who you are (edit this to improve Hermes)',
    '  index.md           ← table of contents, auto-maintained',
    '  commitments.md     ← tracked commitments (outbound + inbound)',
    '  research-log.md    ← log of every autonomous task Hermes ran',
    '  people/*.md        ← one profile per contact (compiled from emails)',
    '  projects/*.md      ← project pages (auto-created when 5+ threads cluster)',
    '',
    '## raw/  — EMAIL ARCHIVE (append-only, never edited)',
    '  YYYY-MM-DD/*.md    ← snapshot of every processed email',
    '',
    '## _data/  — MACHINE DATA (JSON, used by code, not meant for reading)',
    '  people/graph.json          ← contact network (fast lookup)',
    '  people/interactions.json   ← interaction history',
    '  memory/preferences.json    ← schedule, auto-actions, style overrides',
    '  tasks/deadlines.json       ← structured deadline records',
    '  tasks/active_threads.json  ← threads needing replies',
    '  drafts/pending_approvals.json ← drafts waiting for your approval',
    '',
    '## schema.md  — YOUR PREFERENCES (human-edited, never auto-modified)',
    '',
    'RULE: If you want to teach Hermes something, edit wiki/AGENT.md.',
    'RULE: If you want to change how Hermes behaves, edit schema.md.',
    'RULE: Everything else is maintained automatically.'
  ].join('\n');
}

// ============ VAULT MIGRATION ============

/**
 * Migrate legacy Drive layout to the clean structure.
 * Renames root 'people/' to '_data/' so it's clearly distinct from wiki/people/.
 * Safe to run multiple times (idempotent).
 */
function migrateVaultLayout_() {
  var cfg = getConfig();
  var root;
  try {
    root = cfg.ROOT_FOLDER_ID
      ? DriveApp.getFolderById(cfg.ROOT_FOLDER_ID)
      : DriveApp.getRootFolder();
  } catch (e) {
    Logger.log('[MIGRATE] Cannot get root folder: ' + e.message);
    return false;
  }

  // 1. Rename 'people' → '_data' if it exists and '_data' doesn't
  var hasPeople = root.getFoldersByName('people');
  var hasData   = root.getFoldersByName('_data');
  if (hasPeople.hasNext() && !hasData.hasNext()) {
    try {
      var pFolder = hasPeople.next();
      pFolder.setName('_data');
      Logger.log('[MIGRATE] Renamed people/ → _data/');
    } catch (e) {
      Logger.log('[MIGRATE] Could not rename people/: ' + e.message);
    }
  }

  // 2. Rename 'memory' → move its files under _data/ (future: skip for now)
  // 3. Copy AGENT.md into wiki/ if not already there
  try {
    var wikiCopy = readWikiFile_('AGENT.md');
    if (!wikiCopy || wikiCopy.trim().length < 20) {
      var agentContent = getAgentMd_();
      if (agentContent && agentContent.length > 20) {
        writeWikiFile_('AGENT.md', agentContent);
        Logger.log('[MIGRATE] Copied AGENT.md → wiki/AGENT.md');
      }
    }
  } catch (e) {
    Logger.log('[MIGRATE] AGENT.md copy failed: ' + e.message);
  }

  // 4. Build initial context.md if missing
  try {
    var existingCtx = readWikiFile_('context.md');
    if (!existingCtx || existingCtx.trim().length < 20) {
      updateContextMd_();
      Logger.log('[MIGRATE] Built initial context.md');
    }
  } catch (e) {
    Logger.log('[MIGRATE] context.md build failed: ' + e.message);
  }

  Logger.log('[MIGRATE] Vault migration complete.');
  return true;
}

// ============ UPDATED setupVault_ (clean layout for new installs) ============

/**
 * Override the data folder structure for new installs to use _data/.
 * Called from setupHermes() after setupVault_().
 */
function normalizeVaultLayout_() {
  migrateVaultLayout_();
}
