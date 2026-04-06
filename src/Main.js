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
function checkForCommands_() {
  clearMemoryCache_();  // Fresh state each run
  
  const commands = fetchUserCommands_();
  if (commands.length === 0) return;
  
  console.log(`📥 Processing ${commands.length} command(s)...`);
  
  for (const cmd of commands) {
    try {
      processCommand_(cmd.text, cmd.thread, cmd.message);
    } catch (e) {
      console.error(`Command error: ${e.message}`);
      replyInThread_(cmd.thread, quickCard_('❌ Error', escapeHtml(e.message)));
    }
  }
}

/**
 * CHRONOS trigger: Process new emails.
 */
function processNewEmails_() {
  const startTime = Date.now();
  clearMemoryCache_();
  setProp('LAST_ACTION_CONTEXT', 'classify — processing inbox');
  
  const emails = fetchUnprocessedEmails_();
  if (emails.length === 0) return;
  
  console.log(`📬 Processing ${emails.length} email(s)...`);
  
  const prefs = getPreferences_();
  const results = [];
  let totalTokens = 0;
  
  for (const email of emails) {
    try {
      // Use SCRIBE for fast classification
      const c = callScribeClassify_(email, buildClassificationPrompt_());
      totalTokens += (c.tokens || 0);
      
      let actionTaken = 'none';
      
      // Auto-archive patterns
      if (matchesAutoPattern_(email, prefs.auto_actions?.archive_patterns)) {
        archiveEmail_(email.threadId);
        actionTaken = 'auto_archived';
      } else if (c.category === 'noise' && c.suggested_action === 'archive') {
        archiveEmail_(email.threadId);
        actionTaken = 'archived';
      }
      
      // Label important emails
      if (c.suggested_label && c.importance >= 8) {
        labelEmail_(email.threadId, c.suggested_label, email.thread);
      }
      
      // Queue draft for urgent items needing reply
      if (c.should_draft_reply && c.urgency_score >= 6) {
        queueDraftForApproval_(email, c, getAgentMd_(), prefs);
        actionTaken = 'draft_queued';
      }
      
      // Update memory
      updateMemoryFromClassification_(email, c);
      
      results.push({
        from: email.from, subject: email.subject,
        classification: c, action: actionTaken
      });
      
    } catch (e) {
      console.error(`Error on ${email.subject}: ${e.message}`);
      results.push({ error: e.message, from: email.from, subject: email.subject });
    }
  }
  
  storeBriefingItems_(results);
  
  appendJsonArray_('FILE_EXECUTION_LOG', {
    timestamp: new Date().toISOString(),
    trigger: 'processNewEmails',
    count: emails.length, tokens: totalTokens,
    ms: Date.now() - startTime
  });
}

// ============ COMMAND PROCESSOR ============

function processCommand_(text, thread, message) {
  console.log(`📝 Command: "${text.substring(0, 80)}"`);
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
      case 'show_deadlines': return handleShowDeadlines_(thread);
    }
  }
  
  // Complex commands need ORACLE
  const parsed = parseCommandWithGemini_(text, buildCommandPrompt_());
  
  console.log(`🤖 [${parsed.agentUsed}] Intent: ${parsed.intent} (${parsed.confidence})`);
  setProp('LAST_COMMAND', text);
  
  // Route to handler
  const handlers = {
    'approve': () => handleApprove_(parsed.shortcode, parsed.modifications, thread),
    'reject': () => handleReject_(parsed.shortcode, thread),
    'edit': () => handleEdit_(parsed.shortcode, parsed.editInstructions, thread),
    'compose': () => handleCompose_(parsed, thread),
    'query': () => handleQuery_(parsed, thread),
    'research': () => handleResearch_(parsed.originalText, thread),
    'design_change': () => handleDesignChange_(parsed, text, thread),
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