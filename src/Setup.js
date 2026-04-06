/**
 * HERMES — Setup.gs
 * ============================================
 * PANTHEON SYSTEM: Initial Installation & CHRONOS Scheduler
 */

function setupHermes() {
  Logger.log('🏗️ Setting up HERMES Pantheon System...');

  validateConfig();

  // 1. User identity
  const userEmail = Session.getActiveUser().getEmail();
  setProp('USER_EMAIL', userEmail);

  // 2. Create VAULT structure
  setupVault_();

  // 2b. Create wiki folder structure (people, projects, commitments)
  setupWikiVault_();

  // 2c. Raw capture folder (append-only email archive)
  setupRawVault_();

  // 3. Initialize AESTHETE
  initializeTheme_();

  // 4. Install CHRONOS triggers (idempotent)
  installChronosTriggers_();

  // 5. Send welcome email
  sendWelcomeEmail_(userEmail);

  // 6. Reset daily counters
  setProp('SENDS_TODAY', '0');
  setProp('SENDS_DATE', todayStr_());

  Logger.log('✅ HERMES alive. Edit AGENT.md in Drive to personalize.');
}

/**
 * Create folder structure in Google Drive.
 * @private
 */
function setupVault_() {
  const cfg = getConfig();
  const root = cfg.ROOT_FOLDER_ID
    ? DriveApp.getFolderById(cfg.ROOT_FOLDER_ID)
    : DriveApp.getRootFolder();

  const folders = {
    memory: mkdirp_('memory', root),
    archive: mkdirp_('archive', root),
    people: mkdirp_('people', root),
    tasks: mkdirp_('tasks', root),
    agent: mkdirp_('agent', root),
    drafts: mkdirp_('drafts', root)
  };

  setProp('ROOT_FOLDER_ID', root.getId());

  // Create VAULT files (idempotent - won't overwrite)
  mkfile_('FILE_AGENT_MD', 'AGENT.md', root, getAgentMdTemplate_());
  mkfile_('FILE_SCHEMA_MD', 'schema.md', root, getDefaultSchemaMd_());
  mkfile_('FILE_PREFERENCES', 'preferences.json', folders.memory, JSON.stringify(getDefaultPreferences_(), null, 2));
  mkfile_('FILE_EXECUTION_LOG', 'execution_log.json', folders.memory, '[]');
  mkfile_('FILE_DAILY_SUMMARIES', 'daily_summaries.json', folders.memory, '{}');
  mkfile_('FILE_DEADLINES', 'deadlines.json', folders.tasks, '[]');
  mkfile_('FILE_PENDING_APPROVALS', 'pending_approvals.json', folders.drafts, '[]');
  mkfile_('FILE_ACTIVE_THREADS', 'active_threads.json', folders.tasks, '[]');
  mkfile_('FILE_COMPLETED', 'completed.json', folders.archive, '[]');
  mkfile_('FILE_PEOPLE_GRAPH', 'graph.json', folders.people, '{"nodes":{},"edges":[]}');
  mkfile_('FILE_INTERACTIONS', 'interactions.json', folders.people, '{}');
  mkfile_('FILE_CLUSTERS', 'clusters.json', folders.people, '{}');
}

/**
 * Install time-based triggers without duplicates.
 * CRITICAL FIX: Checks existence before creating.
 */
function installChronosTriggers_() {
  // Remove ALL existing Hermes triggers first (clean slate)
  removeAllHermesTriggers_();

  const prefs = getDefaultPreferences_();
  const sched = prefs.schedule || {};

  // 1. Command checker (always on, frequent)
  const cmdInterval = clampInterval_(sched.command_check_minutes || 2);
  ScriptApp.newTrigger('checkForCommands')
    .timeBased()
    .everyMinutes(cmdInterval)
    .create();

  // 2. Email processor
  const procInterval = clampInterval_(sched.process_interval_minutes || 10);
  ScriptApp.newTrigger('processNewEmails')
    .timeBased()
    .everyMinutes(procInterval)
    .create();

  // 3. Briefings (only if enabled)
  if (sched.morning_enabled !== false) {
    ScriptApp.newTrigger('sendMorningBriefing_')
      .timeBased()
      .atHour(sched.morning_hour || 8)
      .everyDays(1)
      .create();
  }

  if (sched.midday_enabled !== false) {
    ScriptApp.newTrigger('sendMiddayCheck_')
      .timeBased()
      .atHour(sched.midday_hour || 13)
      .everyDays(1)
      .create();
  }

  if (sched.evening_enabled !== false) {
    ScriptApp.newTrigger('sendEveningWrap_')
      .timeBased()
      .atHour(sched.evening_hour || 21)
      .everyDays(1)
      .create();
  }

  if (sched.weekly_enabled !== false) {
    ScriptApp.newTrigger('sendWeeklyReport_')
      .timeBased()
      .onWeekDay(ScriptApp.WeekDay.SUNDAY)
      .atHour(sched.weekly_hour || 19)
      .create();
  }

  // Daily proactive research at 06:00 (before morning briefing)
  ScriptApp.newTrigger('runProactiveTasks_')
    .timeBased()
    .atHour(6)
    .everyDays(1)
    .create();

  ScriptApp.newTrigger('runWikiLint_')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SATURDAY)
    .atHour(4)
    .create();

  Logger.log('CHRONOS installed: cmd=' + cmdInterval + 'm, proc=' + procInterval + 'm, proactive=daily 06:00, wikiLint=Sat 04:00');
}

/**
 * Remove all triggers created by Hermes.
 */
function removeAllHermesTriggers_() {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;

  triggers.forEach(t => {
    // All our triggers point to functions ending with _
    const handler = t.getHandlerFunction();
    if (handler && handler.endsWith('_')) {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });

  if (removed > 0) {
    Logger.log(`🧹 Removed ${removed} old triggers`);
  }
}

/**
 * Clamp interval to valid values (1, 5, 10, 15, 30 minutes).
 */
function clampInterval_(mins) {
  const valid = [1, 5, 10, 15, 30];
  let best = valid[0];
  let bestDiff = 999;

  for (const v of valid) {
    const diff = Math.abs(v - mins);
    if (diff < bestDiff) { bestDiff = diff; best = v; }
  }

  return best;
}

// ============ MISSING STUBS (called by setupHermes) ============

/**
 * Returns the default content for AGENT.md in Drive.
 */
/**
 * Default schema.md in Drive (mirrors repo schema.md; user edits in Drive).
 */
function getDefaultSchemaMd_() {
  return [
    '# Hermes Schema — Your Operating Preferences',
    '',
    '> This file controls how Hermes behaves. Edit it to match your workflow.',
    '> Hermes reads this file at the start of each email processing run. It never modifies it.',
    '',
    '---',
    '',
    '## Identity',
    '',
    '- **Your name**: [Your Name]',
    '- **Your role**: [e.g., Founder, Engineer, Researcher]',
    '- **Your timezone**: America/New_York',
    '',
    '---',
    '',
    '## Briefing Preferences',
    '',
    '- **Frequency**: daily',
    '- **Time**: 7:00 AM',
    '- **Format**: email',
    '- **Detail level**: concise (1-2 sentences per item, full detail only for high priority)',
    '- **Max items**: 15',
    '',
    '---',
    '',
    '## Priority Contacts',
    '',
    'People whose emails always surface, regardless of content:',
    '',
    '- [name@example.com] — [relationship context]',
    '- [name@example.com] — [relationship context]',
    '',
    '---',
    '',
    '## Muted Senders',
    '',
    'Emails from these senders are logged but never surfaced in briefings:',
    '',
    '- noreply@*',
    '- notifications@github.com',
    '- *@marketing.*.com',
    '',
    '---',
    '',
    '## Priority Rules',
    '',
    'How Hermes decides what matters:',
    '',
    '1. **Critical**: Direct email from priority contacts with a question or request',
    '2. **High**: Any email requiring a response within 24 hours',
    '3. **Medium**: FYI emails from known contacts, newsletters you actually read',
    '4. **Low**: Automated notifications, CC\'d threads, bulk mail',
    '',
    '---',
    '',
    '## Communication Style',
    '',
    'When Hermes drafts replies on your behalf:',
    '',
    '- **Tone**: professional but warm, not corporate',
    '- **Length**: match the sender\'s length (short reply to short email)',
    '- **Signature**: use my standard Gmail signature',
    '- **Never**: use exclamation marks more than once, use "per my last email", be passive-aggressive',
    '- **Always**: acknowledge what they said before responding, be direct about next steps',
    '',
    '---',
    '',
    '## Commitment Tracking',
    '',
    'What counts as a commitment to track:',
    '',
    '- Explicit promises: "I\'ll send you...", "I\'ll follow up by..."',
    '- Deadlines mentioned in either direction',
    '- Action items assigned to you in meeting recap emails',
    '- Requests you haven\'t responded to in 48+ hours',
    '',
    'What to ignore:',
    '',
    '- Vague pleasantries: "let\'s grab coffee sometime"',
    '- Auto-generated task assignments from project tools',
    '- Commitments older than 30 days with no follow-up',
    '',
    '---',
    '',
    '## Compilation Rules',
    '',
    '- **People profiles**: Create after 3+ email exchanges with same person',
    '- **Project pages**: Create when 5+ threads cluster around same topic',
    '- **Update frequency**: Every run (not just when new email from that person arrives)',
    '- **Confidence markers**: Use [explicit] and [inferred] tags',
    '',
    '---',
    '',
    '## Labels',
    '',
    'Hermes can apply Gmail labels to processed emails:',
    '',
    '- `hermes/briefed` — included in today\'s briefing',
    '- `hermes/draft-ready` — reply draft created',
    '- `hermes/commitment` — contains a tracked commitment',
    '- `hermes/compiled` — content compiled into wiki',
    ''
  ].join('\n');
}

function getAgentMdTemplate_() {
  return [
    '# Hermes — Agent Identity',
    '',
    '## About You',
    'Name: [Your Name]',
    'Role: [Your Role]',
    'Email: [Your Email]',
    '',
    '## Communication Style',
    'Tone: professional but warm',
    'Reply length: match the sender',
    '',
    '## Priority Contacts',
    '(Add emails here, one per line)',
    '',
    '## Notes',
    '(Anything else Hermes should know about you)',
    '',
    '---',
    '*Edit this file to personalize Hermes.*'
  ].join('\n');
}

/**
 * Initialize theme to default midnight.
 */
function initializeTheme_() {
  const existing = getProp('ACTIVE_THEME');
  if (!existing) {
    setProp('ACTIVE_THEME', 'midnight');
  }
}

/**
 * Send a welcome email to the user after setup.
 */
function sendWelcomeEmail_(userEmail) {
  try {
    const subject = 'Hermes is alive';
    const body = [
      '<h2>Hermes is online.</h2>',
      '<p>Your personal AI email agent is now running.</p>',
      '<ul>',
      '<li>Email <strong>[Hermes] brief me</strong> to get a briefing</li>',
      '<li>Email <strong>[Hermes] status</strong> to check system state</li>',
      '<li>Email <strong>[Hermes] pause 24</strong> to pause for 24 hours</li>',
      '</ul>',
      '<p>Edit AGENT.md in your Drive folder to personalize Hermes.</p>',
    ].join('');
    sendHermesEmail_(subject, body);
    Logger.log('Welcome email sent to ' + userEmail);
  } catch (e) {
    Logger.log('[WARN] Welcome email failed: ' + e.message);
  }
}

/**
 * Set up the wiki folder structure in Drive for the compilation layer.
 * Called from setupVault_ or standalone.
 */
function setupWikiVault_() {
  const cfg = getConfig();
  const root = cfg.ROOT_FOLDER_ID
    ? DriveApp.getFolderById(cfg.ROOT_FOLDER_ID)
    : DriveApp.getRootFolder();

  const wiki = mkdirp_('wiki', root);
  mkdirp_('people', wiki);
  mkdirp_('projects', wiki);
  mkdirp_('logs', root);

  // Store wiki root folder ID for use by compilers
  setProp('WIKI_FOLDER_ID', wiki.getId());
  Logger.log('[SETUP] Wiki vault created under: ' + wiki.getId());
  return wiki;
}

// ============ MISSING STUBS (called by command handlers in Main.js) ============

/**
 * Store classified email results for the next briefing.
 */
function storeBriefingItems_(results) {
  try {
    const existing = safeJsonParse(getProp('BRIEFING_QUEUE') || '[]') || [];
    const updated = existing.concat(results.filter(function (r) {
      if (!r || r.error) return false;
      if (r.classification && r.classification.category === 'muted') return false;
      return true;
    }).slice(0, 20));
    // Keep only last 50 items
    setProp('BRIEFING_QUEUE', JSON.stringify(updated.slice(-50)));
  } catch (e) {
    Logger.log('[WARN] storeBriefingItems_ failed: ' + e.message);
  }
}

/**
 * Get the shortcode→approvalId mapping.
 */
function getBriefingMap_() {
  return safeJsonParse(getProp('BRIEFING_MAP') || '{}') || {};
}

/**
 * Parse a command using ORACLE (full NLP).
 */
function parseCommandWithOpenAI_(text, systemPrompt) {
  try {
    var result = callOracleJson_('command_parsing', text, systemPrompt);
    return {
      intent: result.intent || 'conversation',
      shortcode: result.shortcode || null,
      modifications: result.modifications || null,
      compose_to: result.compose_to || null,
      compose_subject: result.compose_subject || null,
      compose_instructions: result.compose_instructions || null,
      originalText: text,
      agentUsed: result._meta ? 'oracle' : 'scribe',
      confidence: result.confidence || 0.5,
      editInstructions: result.edit_instructions || result.modifications || null,
      pause_hours: result.pause_hours || 24,
      research_question: result.research_question || null,
      design_description: result.design_description || null,
      days: result.days || null,
      // Schedule/preference fields
      schedule_field: result.schedule_field || result.schedule_target || null,
      schedule_value: result.schedule_value !== undefined ? result.schedule_value : null,
      preference_key: result.preference_key || result.preference_type || null,
      preference_value: result.preference_value !== undefined ? result.preference_value : null
    };
  } catch (e) {
    Logger.log('[WARN] parseCommandWithOpenAI_ failed: ' + e.message);
    return { intent: 'conversation', agentUsed: 'error', confidence: 0, originalText: text };
  }
}

/**
 * Check auto-archive patterns against an email.
 */
function matchesAutoPattern_(email, patterns) {
  if (!patterns || !patterns.length) return false;
  const from = (email.from || '').toLowerCase();
  const subj = (email.subject || '').toLowerCase();
  for (const pattern of patterns) {
    const p = (pattern || '').toLowerCase();
    if (!p) continue;
    // Wildcard glob: noreply@* → startsWith noreply@
    if (p.endsWith('*')) {
      if (from.startsWith(p.slice(0, -1))) return true;
    } else if (from.includes(p) || subj.includes(p)) {
      return true;
    }
  }
  return false;
}

/**
 * Queue a draft reply for user approval.
 */
function queueDraftForApproval_(email, classification, agentMd, prefs, schemaCommunicationStyle) {
  try {
    // Look up sender context from wiki/graph
    var senderEmail = extractEmailAddress(email.from || '');
    var senderPerson = senderEmail ? lookupPerson(senderEmail) : null;
    var senderContext = senderPerson
      ? 'Known contact: ' + senderPerson.name + ' (' + (senderPerson.type || 'unknown') + '), ' +
        'importance: ' + (senderPerson.importance || 5) + ', ' +
        'interactions: ' + (senderPerson.total_interactions || 0)
      : 'New/unknown contact';

    var commStyle = schemaCommunicationStyle ? String(schemaCommunicationStyle).trim() : '';

    // Build a quality-focused system prompt for email writing
    var writingSystemPrompt = [
      'You are writing an email reply on behalf of the user.',
      '',
      'COMMUNICATION RULES (non-negotiable):',
      '1. Write like a real person, not a corporate chatbot.',
      '2. Never open with "I hope this email finds you well", "Thank you for reaching out", or similar clichés.',
      '3. Never use: "Certainly!", "Absolutely!", "Of course!", "Happy to help!"',
      '4. Match the sender\'s length — if they wrote 2 sentences, write 2-3 sentences back.',
      '5. Be direct about next steps. Say what you will do, not what you "would be happy to do".',
      '6. Use contractions naturally (I\'ll, we\'ll, I\'ve). Formal ≠ stiff.',
      '7. Do not thank them for emailing you unless it is genuinely warranted.',
      '',
      commStyle ? ('STYLE PREFERENCES:\n' + commStyle) : 'Tone: professional but warm. Direct. Specific.',
      '',
      'OUTPUT: Write the plain email body text (not HTML). Hermes will format it.',
      'No subject line, no "Dear X", no signature — just the body paragraphs.'
    ].join('\n');

    var writingUserPrompt = [
      'Write a reply to this email.',
      '',
      'FROM: ' + email.from,
      'SUBJECT: ' + (email.subject || '(no subject)'),
      'SENDER CONTEXT: ' + senderContext,
      'CLASSIFICATION: ' + (classification.category || '?') + ', urgency: ' + (classification.urgency_score || 5),
      'SUMMARY: ' + (classification.summary || ''),
      '',
      'EMAIL BODY:',
      truncate(email.body || '', 1500),
      '',
      'Write the reply body now. Direct, natural, appropriately concise.'
    ].join('\n');

    // Get the written body text from ORACLE
    var draftResult = callAgent_('conversational_reply', writingUserPrompt, writingSystemPrompt, {
      temperature: 0.4,
      maxTokens: 800
    });
    var draftText = draftResult.text || '';

    // Now render the text into themed HTML using FORGE
    var forgePrompt = buildForgePrompt_(
      'email_reply',
      {
        body_text: draftText,
        to: email.from,
        subject: 'Re: ' + (email.subject || '')
      },
      'Render this plain email body into clean, themed HTML. Keep the text exactly as written — only add structure/formatting. No extra sections.'
    );
    var forgeResult = callAgent_('email_generation', forgePrompt.userPrompt, forgePrompt.systemPrompt);
    var draftHtml = forgeResult.text || draftText;

    var approval = {
      id: 'drft_' + generatedId_(),
      type: 'draft_reply',
      status: 'pending',
      to: senderEmail,
      subject: 'Re: ' + (email.subject || ''),
      thread_id: email.threadId,
      urgency: classification.urgency_score || 5,
      draft_html: draftHtml,
      draft_text: draftText,
      created_at: new Date().toISOString()
    };

    addPendingApproval(approval);

    var map = getBriefingMap_();
    var code = String(Object.keys(map).length + 1);
    map[code] = approval.id;
    setProp('BRIEFING_MAP', JSON.stringify(map));

    Logger.log('[DRAFT] Queued draft #' + code + ' for: ' + email.from);
  } catch (e) {
    Logger.log('[WARN] queueDraftForApproval_ failed: ' + e.message);
  }
}

// ============ BRIEFING ENTRY POINTS (CHRONOS triggers) ============

function sendMorningBriefing_() {
  try { generateAndSendBriefing_('Morning Briefing'); } catch (e) { Logger.log('[ERROR] Morning briefing: ' + e.message); }
}

function sendMiddayCheck_() {
  try { generateAndSendBriefing_('Midday Check'); } catch (e) { Logger.log('[ERROR] Midday briefing: ' + e.message); }
}

function sendEveningWrap_() {
  try { generateAndSendBriefing_('Evening Wrap-up'); } catch (e) { Logger.log('[ERROR] Evening briefing: ' + e.message); }
}

function sendWeeklyReport_() {
  try { generateAndSendBriefing_('Weekly Report'); } catch (e) { Logger.log('[ERROR] Weekly briefing: ' + e.message); }
}

/**
 * Core briefing generator. Reads queued items + memory, builds email via ORACLE.
 */
function generateAndSendBriefing_(label) {
  const paused = getProp('PAUSED_UNTIL');
  if (paused && new Date(paused) > new Date()) {
    Logger.log('[BRIEFING] Paused until ' + paused + ', skipping.');
    return;
  }

  const memory = getMemoryDigest_();
  const queue = safeJsonParse(getProp('BRIEFING_QUEUE') || '[]') || [];
  const pending = getAllPendingApprovals_();
  const commitmentsMd = readWikiFile_('commitments.md') || '';

  // Build briefing data
  const briefingData = {
    label: label,
    timestamp: new Date().toISOString(),
    queuedEmails: queue.slice(-15),
    pendingApprovals: pending.length,
    memoryStats: memory.stats,
    deadlines: (memory.structured || {}).upcoming || [],
    overdue: (memory.structured || {}).overdue || [],
    commitmentsSummary: truncate(commitmentsMd, 800)
  };

  var wikiCtx = readWikiContext_(4);

  var prompt = buildForgePrompt_(
    'daily_briefing',
    briefingData,
    [
      'Create a crisp, intelligent briefing. Rules:',
      '- Lead with what needs action TODAY (overdue, urgent, pending approvals).',
      '- Summarize emails in plain language — no bullet-point dumps.',
      '- Include a "Waiting on" section if any commitments are pending from others.',
      '- If nothing urgent: say so briefly, then surface the most interesting item.',
      '- No corporate filler. No "I hope you are doing well." Just substance.',
      '- Under 500 words of content.',
      '',
      'WIKI CONTEXT (use for smart summaries):',
      truncate(wikiCtx, 800)
    ].join('\n')
  );

  const result = callAgent_('email_generation', prompt.userPrompt, prompt.systemPrompt);
  const htmlBody = result.text || '<p>Briefing generation failed.</p>';

  sendHermesEmail_(label, htmlBody);

  // Clear processed queue
  setProp('BRIEFING_QUEUE', '[]');
  Logger.log('[BRIEFING] ' + label + ' sent.');
}

// ============ COMMAND HANDLER STUBS ============
// These route command intents. Full implementations can grow here.

function handleApprove_(shortcode, modifications, thread) {
  const approval = findApprovalByShortcode(shortcode);
  if (!approval) {
    return replyInThread_(thread, quickCard_('Not Found', 'No draft #' + shortcode + ' in queue.'));
  }
  try {
    sendAsUser_({ email: approval.to }, approval.subject, approval.draft_html || '', { htmlBody: approval.draft_html });
    updateApprovalStatus(approval.id, 'approved');
    updateMemoryFromSend_(approval);
    replyInThread_(thread, quickCard_('Sent', 'Draft #' + shortcode + ' sent to ' + approval.to));
  } catch (e) {
    replyInThread_(thread, quickCard_('Error', escapeHtml(e.message)));
  }
}

function handleApproveAll_(thread) {
  const pending = getAllPendingApprovals_();
  let sent = 0;
  for (const approval of pending) {
    try {
      sendAsUser_({ email: approval.to }, approval.subject, approval.draft_html || '', { htmlBody: approval.draft_html });
      updateApprovalStatus(approval.id, 'approved');
      updateMemoryFromSend_(approval);
      sent++;
    } catch (e) { Logger.log('[WARN] ApproveAll skip: ' + e.message); }
  }
  replyInThread_(thread, quickCard_('All Approved', 'Sent ' + sent + ' of ' + pending.length + ' drafts.'));
}

function handleReject_(shortcode, thread) {
  const approval = findApprovalByShortcode(shortcode);
  if (!approval) return replyInThread_(thread, quickCard_('Not Found', 'No draft #' + shortcode));
  updateApprovalStatus(approval.id, 'rejected');
  replyInThread_(thread, quickCard_('Rejected', 'Draft #' + shortcode + ' discarded.'));
}

function handleEdit_(shortcode, instructions, thread) {
  var approval = findApprovalByShortcode(shortcode);
  if (!approval) {
    return replyInThread_(thread, quickCard_('Not Found', 'No draft #' + shortcode + ' in queue.'));
  }

  var schema = getParsedSchema_();
  var agentMd = getAgentMd_();

  var editPrompt = buildForgePrompt_(
    'edit_draft',
    {
      original_draft: truncate(approval.draft_html || '', 2000),
      to: approval.to,
      subject: approval.subject,
      edit_instructions: instructions || 'Improve this draft'
    },
    [
      '═══ SCHEMA: COMMUNICATION STYLE ═══',
      schema.communicationStyle || 'Professional but warm.',
      '',
      '═══ AGENT IDENTITY ═══',
      truncate(agentMd, 400),
      '',
      'Edit the original draft per the edit instructions.',
      'Preserve the intent, improve the execution.',
      'Output the revised HTML body only.'
    ].join('\n')
  );

  try {
    var editResult = callAgent_('conversational_reply', editPrompt.userPrompt, editPrompt.systemPrompt);
    var newHtml = editResult.text || approval.draft_html;

    // Update the draft in place
    var pending = getPendingApprovals_();
    var idx = pending.findIndex(function(p) { return p.id === approval.id; });
    if (idx !== -1) {
      pending[idx].draft_html = newHtml;
      pending[idx].edited_at = new Date().toISOString();
      writeJson('FILE_PENDING_APPROVALS', pending);
    }

    replyInThread_(thread, quickCard_('Draft #' + shortcode + ' Updated',
      'Revised. Reply <strong>approve ' + shortcode + '</strong> to send.'));
  } catch (e) {
    replyInThread_(thread, quickCard_('Edit Error', escapeHtml(e.message)));
  }
}

function handleBriefMe_(thread) {
  generateAndSendBriefing_('On-Demand Briefing');
  replyInThread_(thread, quickCard_('Briefing Sent', 'Check your inbox for the briefing email.'));
}

function handleStatus_(thread) {
  const memory = getMemoryDigest_();
  const pending = getAllPendingApprovals_();
  const paused = getProp('PAUSED_UNTIL');
  const status = paused && new Date(paused) > new Date() ? 'PAUSED until ' + paused : 'RUNNING';
  const body = [
    'Status: ' + status,
    'Pending approvals: ' + pending.length,
    'People tracked: ' + (memory.stats.totalPeople || 0),
    'Active deadlines: ' + (memory.stats.totalDeadlines || 0),
    'Overdue: ' + (memory.stats.overdueCount || 0)
  ].join('<br>');
  replyInThread_(thread, quickCard_('Hermes Status', body));
}

function handlePause_(hours, thread) {
  const until = new Date(Date.now() + hours * 3600000).toISOString();
  setProp('PAUSED_UNTIL', until);
  replyInThread_(thread, quickCard_('Paused', 'Hermes paused for ' + hours + 'h until ' + until));
}

function handleResume_(thread) {
  deleteProp('PAUSED_UNTIL');
  replyInThread_(thread, quickCard_('Resumed', 'Hermes is running again.'));
}

function handleShowDeadlines_(thread, days) {
  days = days || 14;
  var now = new Date();
  var cutoff = new Date(now.getTime() + days * 24 * 3600 * 1000);

  var all = getDeadlines_().filter(function(d) {
    if (d.status !== 'active') return false;
    if (!d.date) return false;
    var dl = new Date(d.date);
    return dl >= now && dl <= cutoff;
  });

  all.sort(function(a, b) { return new Date(a.date) - new Date(b.date); });

  var t = getTheme();

  if (all.length === 0) {
    return replyInThread_(thread, quickCard_(
      'INTEL: NO DEADLINES — NEXT ' + days + ' DAYS',
      '<span style="color:' + t.success + ';font-family:' + (t.mono || t.font) + ';">ALL CLEAR. No active deadlines in the next ' + days + ' days.</span>'
    ));
  }

  var rows = all.map(function(d) {
    var dl = new Date(d.date);
    var diffMs = dl - now;
    var diffDays = Math.ceil(diffMs / (24 * 3600 * 1000));
    var urgencyColor = diffDays <= 2 ? t.accent : diffDays <= 7 ? t.accent3 : t.accent2;
    var eta = diffDays === 0 ? 'TODAY' : diffDays === 1 ? 'T-1D' : 'T-' + diffDays + 'D';
    var cat = (d.category || 'UNKNOWN').toUpperCase();
    return '<tr>' +
      '<td style="padding:9px 14px;border-bottom:1px solid ' + t.border + ';font-family:' + (t.mono || t.font) + ';font-size:12px;color:' + urgencyColor + ';font-weight:700;white-space:nowrap;">' + eta + '</td>' +
      '<td style="padding:9px 14px;border-bottom:1px solid ' + t.border + ';font-family:' + t.font + ';font-size:13px;color:' + t.textBright + ';">' + escapeHtml(d.description) + '</td>' +
      '<td style="padding:9px 14px;border-bottom:1px solid ' + t.border + ';font-family:' + (t.mono || t.font) + ';font-size:11px;color:' + t.textMuted + ';white-space:nowrap;">' + cat + '</td>' +
      '<td style="padding:9px 14px;border-bottom:1px solid ' + t.border + ';font-family:' + (t.mono || t.font) + ';font-size:11px;color:' + t.textMuted + ';text-align:right;white-space:nowrap;">' + escapeHtml(d.date) + '</td>' +
    '</tr>';
  }).join('');

  var tableHtml =
    '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">' +
      '<tr>' +
        '<th style="padding:7px 14px;background:' + t.headerBg + ';font-family:' + (t.mono || t.font) + ';font-size:10px;color:' + t.textMuted + ';text-align:left;letter-spacing:0.12em;text-transform:uppercase;">ETA</th>' +
        '<th style="padding:7px 14px;background:' + t.headerBg + ';font-family:' + (t.mono || t.font) + ';font-size:10px;color:' + t.textMuted + ';text-align:left;letter-spacing:0.12em;text-transform:uppercase;">OBJECTIVE</th>' +
        '<th style="padding:7px 14px;background:' + t.headerBg + ';font-family:' + (t.mono || t.font) + ';font-size:10px;color:' + t.textMuted + ';text-align:left;letter-spacing:0.12em;text-transform:uppercase;">CLASS</th>' +
        '<th style="padding:7px 14px;background:' + t.headerBg + ';font-family:' + (t.mono || t.font) + ';font-size:10px;color:' + t.textMuted + ';text-align:right;letter-spacing:0.12em;text-transform:uppercase;">DATE</th>' +
      '</tr>' +
      rows +
    '</table>';

  replyInThread_(thread, quickCard_(
    '▣ INTEL: DEADLINES — NEXT ' + days + ' DAYS [' + all.length + ' ACTIVE]',
    tableHtml
  ));
}

function handleCompose_(parsed, thread) {
  var to = parsed.compose_to || null;
  var subject = parsed.compose_subject || null;
  var instructions = parsed.compose_instructions || parsed.originalText || '';
  var agentMd = getAgentMd_();
  var schema = getParsedSchema_();

  if (!to && !instructions) {
    replyInThread_(thread, quickCard_('Compose', 'Tell me who to email and what to say. Example: "compose email to john@example.com about the project deadline"'));
    return;
  }

  // Look up person in graph if we have a name
  var recipientEmail = to;
  if (to && !to.includes('@')) {
    var person = lookupPersonByName(to);
    if (person) recipientEmail = person.email;
  }

  // Get person context from wiki if available
  var personContext = '';
  if (recipientEmail) {
    var person2 = lookupPerson(recipientEmail);
    if (person2 && person2.name) {
      personContext = 'Recipient: ' + person2.name + ' (' + person2.type + '), importance: ' + person2.importance;
    }
  }

  var draftPrompt = buildForgePrompt_(
    'compose_email',
    {
      to: recipientEmail || to || '(recipient not specified)',
      subject: subject,
      instructions: instructions,
      recipientContext: personContext || '(new contact)'
    },
    [
      '═══ SCHEMA: COMMUNICATION STYLE (follow exactly) ═══',
      schema.communicationStyle || 'Professional but warm. Direct.',
      '',
      '═══ AGENT IDENTITY ═══',
      truncate(agentMd, 500),
      '',
      'Write a complete email body (not just the HTML wrapper — the actual email content).',
      'Be natural, not corporate. Subject line if not provided: infer from content.',
      'Output HTML for the email body only.'
    ].join('\n')
  );

  try {
    var draftResult = callAgent_('conversational_reply', draftPrompt.userPrompt, draftPrompt.systemPrompt);
    var draftHtml = draftResult.text || '';

    var approval = {
      id: 'drft_' + generatedId_(),
      type: 'compose',
      status: 'pending',
      to: recipientEmail || to || '',
      subject: subject || '(subject from instructions)',
      thread_id: null,
      urgency: 5,
      draft_html: draftHtml,
      created_at: new Date().toISOString()
    };

    addPendingApproval(approval);
    var map = getBriefingMap_();
    var code = String(Object.keys(map).length + 1);
    map[code] = approval.id;
    setProp('BRIEFING_MAP', JSON.stringify(map));

    replyInThread_(thread, quickCard_('Draft Ready — #' + code,
      'Composed email to <strong>' + escapeHtml(recipientEmail || to || 'recipient') + '</strong>.<br>' +
      'Reply <strong>approve ' + code + '</strong> to send, <strong>edit ' + code + ' [instructions]</strong> to revise.'));
  } catch (e) {
    replyInThread_(thread, quickCard_('Compose Error', escapeHtml(e.message)));
  }
}

function handleQuery_(parsed, thread) {
  try {
    const ctx = formatConversationHistory_();
    const result = conductResearch(parsed.research_question || parsed.originalText, ctx);
    replyInThread_(thread, result.answer || quickCard_('Query', 'No results found.'));
  } catch (e) {
    replyInThread_(thread, quickCard_('Error', escapeHtml(e.message)));
  }
}

function handleResearch_(question, thread) {
  try {
    const ctx = formatConversationHistory_();
    const result = conductResearch(question, ctx);
    replyInThread_(thread, result.answer || quickCard_('Research', 'No results found.'));
  } catch (e) {
    replyInThread_(thread, quickCard_('Error', escapeHtml(e.message)));
  }
}

function handleDesignChange_(parsed, text, thread) {
  var themeName = (parsed.design_description || '').trim();
  if (!themeName) {
    if (thread) replyInThread_(thread, quickCard_('Design', 'No design specified.'));
    return;
  }

  var normalized = themeName.toLowerCase();

  // Built-in theme — apply directly
  if (BUILT_IN_THEMES[normalized]) {
    setTheme(normalized);
    if (thread) replyInThread_(thread, quickCard_('THEME SET', 'Active theme: <strong>' + normalized + '</strong>'));
    return;
  }

  // Unknown theme — ask ORACLE to generate a real color palette
  try {
    var themePrompt =
      'Generate a complete HTML email color theme for the style: "' + themeName + '".\n' +
      'Return ONLY valid JSON with these exact keys:\n' +
      '{"name":"' + normalized + '","bg":"#hex","cardBg":"#hex","headerBg":"#hex",' +
      '"text":"#hex","textBright":"#hex","textMuted":"#hex","textDim":"#hex",' +
      '"accent":"#hex","accent2":"#hex","accent3":"#hex","success":"#hex",' +
      '"border":"#hex","radius":"4px","font":"font stack",' +
      '"mono":"\\"Courier New\\", Courier, monospace","style":"brief style desc","vibe":"short vibe"}\n' +
      'Colors must be authentic to the requested style. Return nothing except the JSON object.';

    var generated = callOracleJson_('theme_generation', themePrompt,
      'You are a UI theme designer. Generate cohesive, authentic color palettes for email UIs. Return only valid JSON.');

    if (generated && generated.bg && generated.name) {
      generated.name = normalized;
      setTheme(generated);
      if (thread) replyInThread_(thread, quickCard_('CUSTOM THEME APPLIED', 'Generated and applied: <strong>' + themeName + '</strong>'));
      return;
    }
  } catch (e) {
    Logger.log('[WARN] Theme generation via ORACLE failed: ' + e.message);
  }

  // Fallback: store the name; getTheme() will use default palette
  setTheme(normalized);
  if (thread) replyInThread_(thread, quickCard_('THEME SET', 'Applied: ' + themeName + ' (custom palette generation failed — using base colors)'));
}

function handleConversation_(parsed, text, thread) {
  // Build full context for an intelligent, wiki-aware reply
  var wikiCtx = readWikiContext_(6);
  var memory = getMemoryDigest_();
  var agentMd = getAgentMd_();
  var schema = getParsedSchema_();
  var history = formatConversationHistory_();
  var schemaMd = readSchemaMd_();

  var systemPrompt = buildHermesPersonaPrompt_();

  var userPrompt = [
    '═══ YOUR COMPILED KNOWLEDGE (wiki — use this to answer questions about the user) ═══',
    truncate(wikiCtx, 2500),
    '',
    '═══ MEMORY DIGEST ═══',
    truncate(memory.full, 1500),
    '',
    '═══ USER PREFERENCES (schema) ═══',
    truncate(schemaMd, 600),
    '',
    '═══ CONVERSATION HISTORY ═══',
    history,
    '',
    '═══ USER MESSAGE ═══',
    text,
    '',
    '═══ INSTRUCTIONS ═══',
    'Generate a complete HTML email reply. Rules:',
    '- If they asked what you know about them: enumerate from AGENT.md and wiki above. Be specific.',
    '- If they greeted you: acknowledge + surface something relevant from memory (a deadline, a pending item, etc.).',
    '- If they asked a factual question: answer directly from wiki/memory. No vague promises.',
    '- Never say "I would be happy to", "Certainly!", "Of course!", or lead with pleasantries.',
    '- Never ask permission for actions you can take. Never ask questions unless truly necessary.',
    '- Keep it concise. Match the energy of their message.',
    '- Communication style to follow: ' + (schema.communicationStyle ? truncate(schema.communicationStyle, 200) : 'professional but warm, direct'),
    '- Output ONLY the inner HTML body — tables and divs using theme colors. No <html>/<body> tags.'
  ].join('\n');

  var forgePrompt = buildForgePrompt_('conversation', { message: text }, userPrompt);

  var result;
  try {
    result = callAgent_('conversational_reply', forgePrompt.userPrompt, forgePrompt.systemPrompt);
  } catch (e) {
    Logger.log('[WARN] handleConversation_ ORACLE failed: ' + e.message);
    result = { text: quickCard_('Hermes', 'Got it — ' + escapeHtml(truncate(text, 80))) };
  }

  var html = result.text || quickCard_('Hermes', 'Got it.');
  storeHermesResponse_(truncate(text, 150), truncate(html, 1500));
  replyInThread_(thread, html);

  // Log this conversation query to the research log so Hermes remembers it
  try {
    appendResearchLog_([todayStr_() + ' | conversation | User asked: ' + truncate(text, 120)]);
  } catch (e) { /* non-critical */ }
}

function handleScheduleChange_(parsed, thread) {
  var prefs = getPreferences_();
  var sched = prefs.schedule || {};

  // Ask ORACLE to parse the schedule intent and return field/value
  var parseResult;
  try {
    parseResult = callOracleJson_('command_parsing',
      'Parse this schedule change request and return JSON.\n' +
      'Request: "' + (parsed.originalText || '') + '"\n' +
      'Current schedule: ' + JSON.stringify(sched) + '\n\n' +
      'Return JSON: {"field": "<one of: morning_hour, morning_enabled, midday_hour, midday_enabled, evening_hour, evening_enabled, command_check_minutes, process_interval_minutes, weekly_enabled, weekly_hour>", "value": <new value (number or boolean)>, "description": "<human-readable summary of the change>"}',
      'Extract schedule change intent. Return only JSON.');
  } catch (e) {
    Logger.log('[WARN] Schedule parse failed: ' + e.message);
    parseResult = null;
  }

  if (parseResult && parseResult.field && parseResult.value !== undefined) {
    prefs.schedule = prefs.schedule || {};
    prefs.schedule[parseResult.field] = parseResult.value;
    var ok = writeJson('FILE_PREFERENCES', prefs);
    if (ok) {
      replyInThread_(thread, quickCard_('Schedule Updated', escapeHtml(parseResult.description || 'Changed ' + parseResult.field + ' to ' + parseResult.value)));
    } else {
      replyInThread_(thread, quickCard_('Schedule Error', 'Could not save — FILE_PREFERENCES not initialized. Run setupHermes() first.'));
    }
  } else {
    replyInThread_(thread, quickCard_('Schedule', 'Could not parse that schedule change. Try: "set morning briefing to 9am" or "disable midday check".'));
  }
}

function handlePreference_(parsed, thread) {
  var prefs = getPreferences_();

  // Map known preference keys the user might refer to
  var parseResult;
  try {
    parseResult = callOracleJson_('command_parsing',
      'Parse this preference change request and return JSON.\n' +
      'Request: "' + (parsed.originalText || '') + '"\n' +
      'Current preferences (abbreviated): ' + JSON.stringify({ auto_actions: prefs.auto_actions, urgent_interrupt_threshold: prefs.urgent_interrupt_threshold, max_urgent_per_briefing: prefs.max_urgent_per_briefing }) + '\n\n' +
      'Return JSON: {"path": "<dot-path like auto_actions.archive_patterns>", "action": "set|append|remove", "value": <new value>, "description": "<what changed>"}',
      'Extract preference change intent. Return only JSON.');
  } catch (e) {
    Logger.log('[WARN] Preference parse failed: ' + e.message);
    parseResult = null;
  }

  if (parseResult && parseResult.path && parseResult.action) {
    // Apply the change using dot-path navigation
    try {
      applyPrefChange_(prefs, parseResult.path, parseResult.action, parseResult.value);
      var ok = writeJson('FILE_PREFERENCES', prefs);
      if (ok) {
        replyInThread_(thread, quickCard_('Preference Updated', escapeHtml(parseResult.description || parseResult.path + ' → ' + JSON.stringify(parseResult.value))));
      } else {
        replyInThread_(thread, quickCard_('Preference Error', 'Could not write preferences.'));
      }
    } catch (applyErr) {
      replyInThread_(thread, quickCard_('Preference Error', escapeHtml(applyErr.message)));
    }
  } else {
    replyInThread_(thread, quickCard_('Preference', 'Could not parse that preference change. Try: "archive all emails from noreply@*" or "increase urgent threshold to 9".'));
  }
}

/**
 * Apply a preference change using a dot-path.
 * @private
 */
function applyPrefChange_(prefs, path, action, value) {
  var parts = path.split('.');
  var obj = prefs;
  for (var i = 0; i < parts.length - 1; i++) {
    if (!obj[parts[i]]) obj[parts[i]] = {};
    obj = obj[parts[i]];
  }
  var key = parts[parts.length - 1];

  if (action === 'set') {
    obj[key] = value;
  } else if (action === 'append') {
    if (!Array.isArray(obj[key])) obj[key] = [];
    if (obj[key].indexOf(value) === -1) obj[key].push(value);
  } else if (action === 'remove') {
    if (Array.isArray(obj[key])) {
      obj[key] = obj[key].filter(function(v) { return v !== value; });
    }
  }
}

function handleContextUpdate_(parsed, thread) {
  if (parsed.context_text) {
    addConversationTurn_('user', parsed.context_text);
    replyInThread_(thread, quickCard_('Context Updated', 'Added to conversation memory.'));
  }
}

function handleRetryLast_(thread) {
  const last = getProp('LAST_COMMAND');
  if (last) {
    processCommand_(last, thread, null);
  } else {
    replyInThread_(thread, quickCard_('Retry', 'No previous command to retry.'));
  }
}

/**
 * HELPER: Force set the OpenAI API key if the GAS UI is glitching.
 * Paste your key below, run this once, then delete the key from the script.
 */
function setOpenAIKey() {
  const key = "PASTE_YOUR_KEY_HERE";
  if (key === "PASTE_YOUR_KEY_HERE") {
    Logger.log("❌ Please paste your actual key in the function first.");
    return;
  }
  PropertiesService.getScriptProperties().setProperty('OPENAI_API_KEY', key);
  Logger.log("✅ OPENAI_API_KEY saved successfully via PropertiesService.");
}