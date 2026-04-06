/**
 * HERMES — Main.gs
 * ============================================
 * PANTHEON SYSTEM: CONSCIOUSNESS (Central Decision Router)
 * 
 * Routes incoming stimuli to appropriate subsystems.
 */

// ============ TRIGGER ENTRY POINTS ============

/**
 * CHRONOS trigger: Check for user commands.
 */
function checkForCommands() {
  clearMemoryCache_();  // Fresh state each run

  const commands = fetchUserCommands_();
  if (commands.length === 0) return;

  Logger.log(`📥 Processing ${commands.length} command(s)...`);

  for (const cmd of commands) {
    try {
      processCommand_(cmd.text, cmd.thread, cmd.message);
    } catch (e) {
      Logger.log(`[ERROR] Command error: ${e.message}`);
      replyInThread_(cmd.thread, quickCard_('❌ Error', escapeHtml(e.message)));
    }
  }
}

/**
 * Run classify → memory → briefing queue → wiki compile for a pre-built email batch.
 * Used by processNewEmails, Tests, and cold start.
 *
 * @param {Array} emails same shape as fetchUnprocessedEmails_()
 * @param {{ verboseLog?: boolean, skipBriefingQueue?: boolean }} options
 * @returns {{ totalTokens: number, results: Array, compilationInput: Array }}
 */
function runHermesPipelineOnBatch_(emails, options) {
  options = options || {};
  var empty = { totalTokens: 0, results: [], compilationInput: [] };
  if (!emails || emails.length === 0) return empty;

  var schemaParsed;
  try {
    schemaParsed = getParsedSchema_();
  } catch (se) {
    Logger.log('[WARN] Schema load failed: ' + se.message);
    schemaParsed = { priorityContacts: [], mutedSenders: [], communicationStyle: '' };
  }

  try {
    captureRawEmails_(emails);
  } catch (re) {
    Logger.log('[WARN] Raw capture failed: ' + re.message);
  }

  var prefs = getPreferences_();
  var results = [];
  var totalTokens = 0;
  var classPrompt = buildClassificationPrompt_(schemaParsed);
  var commStyle = schemaParsed.communicationStyle || '';

  for (var ei = 0; ei < emails.length; ei++) {
    var email = emails[ei];
    try {
      var c;
      var actionTaken = 'none';

      if (isMutedSender_(email, schemaParsed.mutedSenders)) {
        c = {
          category: 'muted',
          urgency_score: 1,
          needs_reply: false,
          should_draft_reply: false,
          summary: '(muted sender — classification skipped)',
          importance: 1,
          suggested_action: 'none',
          suggested_label: null,
          sender_name: '',
          sender_type: 'service',
          extracted_deadline: null,
          tokens: 0,
          agentUsed: 'none'
        };
        actionTaken = 'muted_skipped';
      } else {
        c = callScribeClassify_(email, classPrompt);
        totalTokens += (c.tokens || 0);
        applyPriorityContactBoost_(email, c, schemaParsed.priorityContacts || []);

        c.sender_email = extractEmailAddress(email.from);
        if (!c.sender_name && email.from) {
          var fn = email.from.match(/^"?([^"<]+)"?\s*</);
          c.sender_name = fn ? fn[1].trim() : c.sender_email;
        }
        if (c.extracted_deadline && !c.deadline_date) {
          c.deadline_date = c.extracted_deadline;
          c.has_deadline = true;
        }
        if (c.summary && !c.deadline_description && c.has_deadline) {
          c.deadline_description = c.summary;
        }

        if (matchesAutoPattern_(email, prefs.auto_actions && prefs.auto_actions.archive_patterns)) {
          archiveEmail_(email.threadId);
          actionTaken = 'auto_archived';
        } else if (c.category === 'noise' && c.suggested_action === 'archive') {
          archiveEmail_(email.threadId);
          actionTaken = 'archived';
        }

        if (c.suggested_label && c.importance >= 8) {
          labelEmail_(email.threadId, c.suggested_label, email.thread);
        }

        if (c.should_draft_reply && c.urgency_score >= 6) {
          queueDraftForApproval_(email, c, getAgentMd_(), prefs, commStyle);
          actionTaken = 'draft_queued';
        }

        updateMemoryFromClassification_(email, c);
      }

      if (options.verboseLog) {
        Logger.log('[PIPE] ' + (email.subject || '') + ' -> ' + (c.category || '?') + ' action=' + actionTaken);
      }

      results.push({
        from: email.from, subject: email.subject,
        classification: c, action: actionTaken
      });
    } catch (e) {
      Logger.log('[ERROR] Error on email \'' + (email.subject || '') + '\': ' + e.message);
      results.push({ error: e.message, from: email.from, subject: email.subject });
    }
  }

  if (!options.skipBriefingQueue) {
    storeBriefingItems_(results);
  }

  var compilationInput = emails.map(function (em, i) {
    return { email: em, classification: results[i] && results[i].classification ? results[i].classification : {} };
  }).filter(function (row) {
    return row.classification && row.classification.category !== 'muted';
  });

  try {
    updatePeopleProfiles_(compilationInput);
  } catch (e) {
    Logger.log('[WARN] People compilation failed: ' + e.message);
  }

  try {
    extractCommitments_(compilationInput);
  } catch (e) {
    Logger.log('[WARN] Commitment extraction failed: ' + e.message);
  }

  return { totalTokens: totalTokens, results: results, compilationInput: compilationInput };
}

/**
 * CHRONOS trigger: Process new emails.
 */
function processNewEmails() {
  const startTime = Date.now();
  clearMemoryCache_();
  setProp('LAST_ACTION_CONTEXT', 'classify — processing inbox');

  const emails = fetchUnprocessedEmails_();
  if (emails.length === 0) return;

  Logger.log(`📬 Processing ${emails.length} email(s)...`);

  const r = runHermesPipelineOnBatch_(emails);

  appendJsonArray_('FILE_EXECUTION_LOG', {
    timestamp: new Date().toISOString(),
    trigger: 'processNewEmails',
    count: emails.length, tokens: r.totalTokens,
    ms: Date.now() - startTime
  });
}


// ============ COMMAND PROCESSOR ============

function processCommand_(text, thread, message) {
  Logger.log(`📝 Command: "${text.substring(0, 80)}"`);
  addConversationTurn_('user', text);

  // Quick parse for simple commands (no AI needed)
  const quick = quickParseCommand_(text);

  if (quick) {
    switch (quick.intent) {
      case 'approve': return handleApprove_(quick.shortcode, null, thread);
      case 'reject': return handleReject_(quick.shortcode, thread);
      case 'approve_all': return handleApproveAll_(thread);
      case 'brief_me': return handleBriefMe_(thread);
      case 'status': return handleStatus_(thread);
      case 'pause': return handlePause_(quick.hours || 24, thread);
      case 'resume': return handleResume_(thread);
      case 'show_deadlines': return handleShowDeadlines_(thread, quick.days || 14);
    }
  }

  // Complex commands need ORACLE
  const parsed = parseCommandWithOpenAI_(text, buildCommandPrompt_());

  Logger.log(`🤖 [${parsed.agentUsed}] Intent: ${parsed.intent} (${parsed.confidence})`);
  setProp('LAST_COMMAND', text);

  // If ORACLE detected a design change alongside another intent, apply theme first
  if (parsed.design_description && parsed.intent !== 'design_change') {
    handleDesignChange_(parsed, text, null);  // null thread = no reply for the theme sub-step
  }

  // Route to handler
  const handlers = {
    'approve': () => handleApprove_(parsed.shortcode, parsed.modifications, thread),
    'reject': () => handleReject_(parsed.shortcode, thread),
    'edit': () => handleEdit_(parsed.shortcode, parsed.editInstructions, thread),
    'compose': () => handleCompose_(parsed, thread),
    'query': () => handleQuery_(parsed, thread),
    'research': () => handleResearch_(parsed.originalText, thread),
    'show_deadlines': () => handleShowDeadlines_(thread, parsed.days || 14),
    'design_change': () => handleDesignChange_(parsed, text, thread),
    'ui_feedback': () => handleUiFeedback_(parsed, text, thread),
    'conversation': () => handleConversation_(parsed, text, thread),
    'schedule_change': () => handleScheduleChange_(parsed, thread),
    'preference': () => handlePreference_(parsed, thread),
    'context_update': () => handleContextUpdate_(parsed, thread),
    'pause': () => handlePause_(parsed.pause_hours || 24, thread),
    'resume': () => handleResume_(thread),
    'retry_last': () => handleRetryLast_(thread)
  };

  const handler = handlers[parsed.intent];
  if (handler) {
    return handler();
  }

  // Default: treat as conversation
  return handleConversation_(parsed, text, thread);
}