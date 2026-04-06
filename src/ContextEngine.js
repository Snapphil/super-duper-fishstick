/**
 * HERMES — ContextEngine.gs
 * ============================================
 * PANTHEON SYSTEM: Context Assembly & Prompt Engineering
 * 
 * Builds rich context prompts for ORACLE/SCRIBE calls.
 * Optimized for token efficiency.
 */

// ============ THEME STATE ============
// NOTE: setTheme() and getActiveTheme() are canonical in ThemeEngine.js
// This alias avoids duplicate global function errors in Apps Script.

function getActiveTheme_() {
  return getProp('ACTIVE_THEME') || 'midnight';
}

// ============ WIKI CONTEXT READER ============

/**
 * Read compiled wiki content for injection into prompts.
 * Reads index, commitments, and most recent people profiles.
 * @param {number} maxPeople - Max people profiles to include (default 6)
 * @returns {string} Formatted wiki context block
 */
function readWikiContext_(maxPeople) {
  maxPeople = maxPeople || 6;
  var parts = [];

  try {
    var index = readWikiFile_('index.md');
    if (index && index.trim().length > 10) {
      parts.push('[ WIKI / INDEX ]\n' + truncate(index, 500));
    }
  } catch (e) { Logger.log('[WARN] wiki index: ' + e.message); }

  try {
    var commitments = readWikiFile_('commitments.md');
    if (commitments && commitments.trim().length > 10) {
      parts.push('[ WIKI / COMMITMENTS ]\n' + truncate(commitments, 1000));
    }
  } catch (e) { Logger.log('[WARN] wiki commitments: ' + e.message); }

  try {
    var wikiFolder = getWikiFolder_();
    if (wikiFolder) {
      var pf = wikiFolder.getFoldersByName('people');
      if (pf.hasNext()) {
        var peopleFolder = pf.next();
        var files = peopleFolder.getFiles();
        var peopleFiles = [];
        while (files.hasNext()) {
          var file = files.next();
          peopleFiles.push(file);
        }
        // Sort by most recently updated
        peopleFiles.sort(function(a, b) {
          return b.getLastUpdated().getTime() - a.getLastUpdated().getTime();
        });
        var count = Math.min(maxPeople, peopleFiles.length);
        for (var i = 0; i < count; i++) {
          try {
            var content = peopleFiles[i].getBlob().getDataAsString();
            var label = peopleFiles[i].getName().replace('.md', '');
            parts.push('[ WIKI / PEOPLE / ' + label.toUpperCase() + ' ]\n' + truncate(content, 600));
          } catch (fe) { /* skip broken file */ }
        }
      }
    }
  } catch (e) { Logger.log('[WARN] wiki people: ' + e.message); }

  return parts.length > 0 ? parts.join('\n\n') : '(No wiki content compiled yet — will populate as emails are processed.)';
}

/**
 * Build the system persona prompt used across all ORACLE calls.
 * This is the "identity illusion" — Hermes always knows who it is.
 */
function buildHermesPersonaPrompt_() {
  var agentMd = getAgentMd_();
  var schema = getParsedSchema_();
  var t = getTheme();
  var now = new Date();

  return [
    'You are Hermes — a deeply personal AI email agent.',
    '',
    'Your core purpose: act as an intelligent, knowledgeable extension of the person you serve.',
    'You have persistent memory (wiki), compiled from every email you have processed.',
    'You know this person\'s commitments, relationships, patterns, and preferences.',
    '',
    '=== WHO YOU SERVE ===',
    truncate(agentMd, 600),
    '',
    '=== THEIR COMMUNICATION STYLE (follow exactly) ===',
    schema.communicationStyle || 'Professional but warm. Direct. No corporate filler.',
    '',
    '=== YOUR BEHAVIORAL RULES ===',
    '1. NEVER ask permission for actions you can execute directly.',
    '2. NEVER ask clarifying questions unless the request is genuinely ambiguous.',
    '3. NEVER say "I would be happy to...", "Certainly!", "Of course!", or any hollow opener.',
    '4. When asked what you know — enumerate it from your wiki and memory. Do not be vague.',
    '5. Be direct. Match the sender\'s energy. Short reply to short message.',
    '6. You are confident about what you know. Qualify only when genuinely uncertain.',
    '7. Update your understanding from every interaction — you get smarter over time.',
    '',
    '=== CURRENT TIME ===',
    now.toISOString() + ' — ' + ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][now.getDay()],
    '',
    '=== VISUAL THEME ===',
    'Active theme: ' + t.name + ' | Style: ' + (t.style || 'dark minimal')
  ].join('\n');
}

function getThemeList() {
  return ['default', 'dark', 'light', 'neon', 'brutalist', 'minimal', 'pastel', 'corporate', 'playful'];
}

// ============ MAIN PROMPT BUILDERS ============

/**
 * Build comprehensive prompt for command processing (intent parsing only).
 * Includes memory, schedule, identity, conversation history, and wiki context.
 */
function buildCommandPrompt_() {
  var agentMd = getAgentMd_();
  var pending = getAllPendingApprovals_();
  var map = getBriefingMap_();
  var prefs = getPreferences_();
  var lastAction = getProp('LAST_ACTION_CONTEXT') || 'none';
  var lastResponse = getLastHermesResponse_();
  var memory = getMemoryDigest_();
  var wikiCtx = readWikiContext_(3);  // Inject top 3 people profiles
  var now = new Date();
  var theme = getActiveTheme_();

  // Pending approvals summary
  var pendingSummary = pending.map(function(p) {
    var code = '?';
    var entries = Object.entries ? Object.entries(map) : Object.keys(map).map(function(k) { return [k, map[k]]; });
    for (var i = 0; i < entries.length; i++) {
      if (entries[i][1] === p.id) { code = entries[i][0]; break; }
    }
    return '#' + code + ': [' + p.type + '] ' + p.subject + ' — urgency: ' + p.urgency;
  }).join('\n') || '(None.)';

  return [
    'You are Hermes — a personal AI email agent parsing a user command.',
    '',
    '═══ YOUR HUMAN ═══',
    truncate(agentMd, 500),
    '',
    '═══ COMPILED WIKI KNOWLEDGE ═══',
    truncate(wikiCtx, 1500),
    '',
    '═══ MEMORY DIGEST ═══',
    truncate(memory.full, 1200),
    '',
    '═══ CONVERSATION HISTORY ═══',
    formatConversationHistory_(),
    '',
    '═══ LAST RESPONSE ═══',
    truncate(lastResponse.full || '(None.)', 400),
    '',
    '═══ PENDING APPROVALS ═══',
    pendingSummary,
    '',
    '═══ SCHEDULE ═══',
    'Cmd: ' + ((prefs.schedule && prefs.schedule.command_check_minutes) || 2) + 'm | ' +
    'Proc: ' + ((prefs.schedule && prefs.schedule.process_interval_minutes) || 10) + 'm | ' +
    'AM: ' + ((prefs.schedule && prefs.schedule.morning_enabled) !== false ? ((prefs.schedule && prefs.schedule.morning_hour) || 8) + ':00' : 'off') + ' | ' +
    'PM: ' + ((prefs.schedule && prefs.schedule.evening_enabled) !== false ? ((prefs.schedule && prefs.schedule.evening_hour) || 21) + ':00' : 'off'),
    '',
    '═══ NOW ═══',
    now.toISOString() + ' (' + getDayName(now) + ') | Theme: ' + theme,
    '',
    '═══ LAST ACTION ═══',
    lastAction,
    '',
    '═══ TASK ═══',
    'Parse the human\'s message. Return JSON only:',
    '',
    '{',
    '  "intent": "approve|reject|edit|approve_all|compose|reply_to|query|brief_me|schedule_change|preference|context_update|pause|resume|status|show_deadlines|show_people|show_memory|design_change|research|follow_up|conversation",',
    '  "shortcode": null,',
    '  "modifications": null,',
    '  "compose_to": null,',
    '  "compose_subject": null,',
    '  "compose_instructions": null,',
    '  "query_target": null,',
    '  "schedule_field": null,',
    '  "schedule_value": null,',
    '  "schedule_enabled": null,',
    '  "preference_key": null,',
    '  "preference_value": null,',
    '  "context_text": null,',
    '  "pause_hours": null,',
    '  "design_description": null,',
    '  "research_question": null,',
    '  "research_depth": "deep|quick",',
    '  "days": null,',
    '  "confidence": 0.0,',
    '  "reasoning": "brief"',
    '}'
  ].join('\n');
}

/**
 * Build classification prompt for SCRIBE (fast, lightweight).
 * @param {{ priorityContacts?: string[] }} schemaOpts from parseHermesSchemaMd_
 */
function buildClassificationPrompt_(schemaOpts) {
  const prefs = getPreferences_();
  const lastAction = getProp('LAST_ACTION_CONTEXT') || 'classify';
  const schemaOptsSafe = schemaOpts || {};
  const pri = Array.isArray(schemaOptsSafe.priorityContacts) && schemaOptsSafe.priorityContacts.length
    ? schemaOptsSafe.priorityContacts.join(', ')
    : '(none configured)';

  return `
Classify this incoming email precisely.

PRIORITY CONTACTS (always treat as high-signal; surface prominently, bump importance/urgency appropriately):
${pri}

RESPOND JSON ONLY:
{
  "category": "meeting|deadline|noise|personal|urgent|info|newsletter|receipt|social|job|followup",
  "urgency_score": 0-10,
  "needs_reply": bool,
  "should_draft_reply": bool,
  "extracted_deadline": "YYYY-MM-DD or null",
  "sender_type": "boss|client|friend|family|service|recruiter|unknown",
  "sender_name": "name extracted",
  "summary": "one line what this is about",
  "suggested_action": "archive|label|draft_reply|flag|none",
  "suggested_label": "label name or null",
  "importance": 1-10,
  "auto_actions": {"archive_patterns": [], "label_patterns": []}
}
`.trim();
}

/**
 * Build prompt for ORACLE email generation (FORGE input).
 */
function buildForgePrompt_(purpose, data, additionalInstructions) {
  const themeCtx = getThemePromptContext();
  const t = getTheme();
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  const sys = `You are Hermes — a world-class email designer generating mobile-safe HTML.

 ${themeCtx}

ABSOLUTE RULES (breaking these = broken email):

LAYOUT:
• Ensure mobile and web compatibility by strictly using fluid wrappers and percentage-based sizing.
• All layout uses <table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width: 100%;"> — NEVER display:flex or display:grid
• Use padding for spacing rather than margins (margins are often ignored by email clients).
• ALL styles INLINE (<div style="...">) — no <style> blocks
• Close EVERY tag. Every <table> needs </table>. Every <td> needs </td>. Every <div> needs </div>.
• Keep nesting shallow — max 4 levels of tables

CONTENT:
• Never use Unicode emoji characters (😀❤️✅ etc) — they break in email clients
• Instead use these HTML-safe alternatives: •Bullet: &#8226; •Check: &#10003; •Cross: &#10007; •Star: &#9733; •Arrow right: &#8594; •Arrow up-right: &#8599; •Warning: &#9888;

TYPOGRAPHY:
• Put font-family:${t.font} on EVERY element that has text
• ONLY web-safe fonts — no Google Fonts
• Keep font-size between 10px and 28px
• Use font-weight:800 for big numbers, 700 for headings, 400 for body

LENGTH:
• KEEP IT CONCISE. Under 3000 characters of HTML.
• If showing a theme: 3-4 color switches, one stat row example, one card example. That is enough.
• If showing research: headline + metrics + findings + one insight box. Done.
• Do NOT create elaborate multi-section showcases. Simple and clean wins.

STRUCTURE:
Output ONLY the inner HTML. It will be wrapped. Start with header, then content, then footer.`;

  const dataStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2);

  return {
    systemPrompt: sys,
    userPrompt: `PURPOSE: ${purpose}

DATA:
 ${truncate(dataStr, 3000)}

 ${additionalInstructions ? `INSTRUCTIONS: ${additionalInstructions}` : ''}

Generate concise, clean HTML. Under 3000 chars. No emoji Unicode. Close all tags.`
  };
}

// ============ CONVERSATION HISTORY ============

const MAX_CONVERSATION_TURNS = 8;
const CONVERSATION_TTL_MS = 2 * 3600000; // 2 hours

function getConversationHistory_() {
  const raw = getProp('CONVERSATION_HISTORY');
  return safeJsonParse(raw) || [];
}

function addConversationTurn_(role, text) {
  let history = getConversationHistory_();

  history.push({
    role: role,
    text: truncate(text, 500),
    timestamp: new Date().toISOString()
  });

  // Keep only recent turns
  while (history.length > MAX_CONVERSATION_TURNS) {
    history.shift();
  }

  // Expire old turns (older than 2 hours = new conversation)
  const cutoff = Date.now() - CONVERSATION_TTL_MS;
  history = history.filter(t => new Date(t.timestamp).getTime() >= cutoff);

  setProp('CONVERSATION_HISTORY', JSON.stringify(history));
}

function formatConversationHistory_() {
  const history = getConversationHistory_();
  if (history.length === 0) return 'No recent conversation.';

  return history.map(t => {
    const who = t.role === 'user' ? '👤 HUMAN' : '🤖 HERMES';
    return `${who}: ${t.text}`;
  }).join('\n');
}

function storeHermesResponse_(summary, fullContext) {
  addConversationTurn_('hermes', summary);
  setProp('LAST_HERMES_RESPONSE', JSON.stringify({
    summary: truncate(summary, 2000),
    full: truncate(fullContext || summary, 2000),
    timestamp: new Date().toISOString()
  }));
}

function getLastHermesResponse_() {
  return safeJsonParse(getProp('LAST_HERMES_RESPONSE')) || {};
}

function clearConversation_() {
  setProp('CONVERSATION_HISTORY', '[]');
  deleteProp('LAST_HERMES_RESPONSE');
}

// ============ HELPERS ============

function getDayName(d) {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()];
}