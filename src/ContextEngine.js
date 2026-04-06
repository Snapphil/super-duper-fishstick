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

function getThemeList() {
  return Object.keys(BUILT_IN_THEMES);
}

// ============ MAIN PROMPT BUILDERS ============

/**
 * Build comprehensive prompt for command processing.
 * Includes memory, schedule, identity, conversation history.
 */
function buildCommandPrompt_() {
  const agentMd = getAgentMd_();
  const pending = getAllPendingApprovals_();
  const map = getBriefingMap_();
  const deadlines = getDeadlines_();
  const prefs = getPreferences_();
  const graph = getPeopleGraph_();
  const lastAction = getProp('LAST_ACTION_CONTEXT') || 'none';
  const lastResponse = getLastHermesResponse_();
  const memory = getMemoryDigest_();
  const now = new Date();
  const theme = getActiveTheme_();  // FIXED: use alias, canonical setTheme/getActiveTheme are in ThemeEngine.js

  // Known people summary (token-optimized)
  const knownPeople = Object.values(graph.nodes || {})
    .map(p => `${p.name} (${p.email}) | ${p.type} | imp:${p.importance}`)
    .join('\n')
    || '(none)';

  // Pending approvals summary
  const pendingSummary = pending.map(p => {
    const code = Object.entries(map).find(([k, v]) => v === p.id)?.[0] || '?';
    return `#${code}: [${p.type}] ${p.subject} — urgency: ${p.urgency}`;
  }).join('\n') || '(None.)';

  return `
You are Hermes ← an intelligent email agent with research AND memory capabilities.

You have PERSISTENT MEMORY stored in files. You remember deadlines, people, conversations, and research insights.

You understand natural language, follow-ups, context, slang, ambiguity.

═══ YOUR HUMAN ═══
 ${agentMd}

═══ CONVERSATION ═══
 ${formatConversationHistory_()}

═══ LAST RESPONSE ═══
 ${truncate(lastResponse.full || '(None.)', 600)}

═══ MY MEMORY (what I already know) ═══
 ${memory.full}

═══ DESIGN STATE ═══
Active Theme: ${theme}
Built-in themes: ${getThemeList().join(', ')}
${getUiPrefsContext_()}

═══ PENDING APPROVALS ═══
 ${pendingSummary || 'None.'}

═══ LAST ACTION ═══
 ${lastAction}

═══ SCHEDULE ═══
Cmd: ${(prefs.schedule && prefs.schedule.command_check_minutes) || 2}m | Proc: ${(prefs.schedule && prefs.schedule.process_interval_minutes) || 10}m
AM: ${(prefs.schedule && prefs.schedule.morning_enabled) !== false ? ((prefs.schedule && prefs.schedule.morning_hour) || 8) + ':00' : 'off'}
PM: ${(prefs.schedule && prefs.schedule.evening_enabled) !== false ? ((prefs.schedule && prefs.schedule.evening_hour) || 21) + ':00' : 'off'}
═══ NOW ═══
 ${now.toISOString()} (${getDayName(now)})

═══ TASK ═══
Parse the human's message. Return JSON:

{
  "intent": "approve|reject|edit|approve_all|compose|reply_to|query|brief_me|schedule_change|preference|context_update|pause|resume|status|show_deadlines|show_people|show_memory|design_change|ui_feedback|research|follow_up|conversation",
  "shortcode": null,
  "modifications": null,
  "compose_to": null,
  "compose_subject": null,
  "compose_instructions": null,
  "query_target": null,
  "schedule_target": null,
  "schedule_value": null,
  "schedule_enabled": null,
  "preference_rule": null,
  "preference_type": null,
  "context_text": null,
  "pause_hours": null,
  "design_description": "Desired design/theme if design_change intent, null otherwise",
  "days": "Number of days if time window specified (e.g. 14 for 'next 14 days'), null otherwise",
  "ui_feedback_sentiment": "positive|negative|neutral — only for ui_feedback intent, null otherwise",
  "ui_dos": ["extracted do-rules from user's UI feedback, e.g. 'use high contrast', empty array if none"],
  "ui_donts": ["extracted dont-rules from user's UI feedback, e.g. 'avoid tiny fonts', empty array if none"],
  "research_question": "Rephrased research question with specifics. Null if not research.",
  "research_depth": "deep|quick",
  "conversational_response": "Under 50 words, null if not conversation.",
  "confidence": 0.0-1.0,
  "reasoning": "brief"
}
`.trim();
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