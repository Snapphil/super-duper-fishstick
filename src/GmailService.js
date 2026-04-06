/**
 * HERMES — GmailService.gs
 * ============================================
 * PANTHEON SYSTEM: RELAY (Email Communication Layer)
 * 
 * Handles fetching, sending, searching, labeling with proper error handling.
 */

// ============ FETCHING ============

/**
 * Fetch unprocessed emails (not from Hermes, not commands).
 * Returns array of email objects.
 */
function fetchUnprocessedEmails_() {
  const cfg = getConfig();
  
  const query = [
    `is:unread`,
    `-label:${cfg.PROCESSED_LABEL}`,
    `subject:${cfg.BRIEFING_TAG}`,
    `in:spam`,
    `in:trash`
  ].join(' ');
  
  let threads;
  try {
    threads = GmailApp.search(query, 0, cfg.MAX_EMAILS_PER_RUN);
  } catch (e) {
    console.error(`Search failed: ${e.message}`);
    return [];
  }
  
  if (!threads || threads.length === 0) return [];
  
  const emails = [];
  
  for (const thread of threads) {
    try {
      const msgs = thread.getMessages();
      const m = msgs[msgs.length - 1]; // Latest message
      
      emails.push({
        threadId: thread.getId(),
        messageId: m.getId(),
        from: m.getFrom(),
        to: m.getTo() || '',
        cc: m.getCc() || '',
        subject: m.getSubject() || '(no subject)',
        body: m.getPlainTextBody() || '',
        htmlBody: m.getBody() || '',
        date: m.getDate(),
        threadSize: msgs.length,
        thread: thread,
        message: m,
        snippet: truncate(m.getPlainTextBody(), 250)
      });
      
    } catch (e) {
      console.warn(`Skip broken thread ${thread?.getId()}: ${e.message}`);
    }
  }
  
  return emails;
}

/**
 * Fetch user command emails (from user, with [Hermes] tag, unread).
 */
function fetchUserCommands_() {
  const cfg = getConfig();
  
  const query = [
    `subject:${cfg.BRIEFING_TAG}`,
    `-label:${cfg.PROCESSED_LABEL}`,
    `newer_than:1d`
  ].join(' ');
  
  let threads;
  try {
    threads = GmailApp.search(query, 0, 10);
  } catch (e) {
    console.error(`Command search failed: ${e.message}`);
    return [];
  }
  
  if (!threads || threads.length === 0) return [];
  
  const commands = [];
  
  for (const thread of threads) {
    try {
      const msgs = thread.getMessages();
      const latest = msgs[msgs.length - 1];
      const html = latest.getBody() || '';
      
      // Skip if Hermes generated this
      if (html.includes(cfg.AGENT_MARKER)) {
        markProcessed_(thread);
        continue;
      }
      
      // Extract command text
      const rawBody = latest.getPlainTextBody() || '';
      const commandText = extractReplyText(rawBody);
      
      if ((commandText || '').trim().length === 0) {
        markProcessed_(thread);
        continue;
      }
      
      commands.push({
        text: commandText.trim(),
        thread: thread,
        message: latest,
        subject: latest.getSubject() || ''
      });
      
    } catch (e) {
      console.warn(`Error reading command thread: ${e.message}`);
    }
  }
  
  return commands;
}

/**
 * Search emails with deduplication.
 * @param {string} query - Gmail search query
 * @param {number} maxResults - Max results per query (default 25)
 * @returns {Array} Email objects sorted by date descending
 */
function searchEmails_(query, maxResults) {
  maxResults = Math.min(maxResults || 25, 75); // Cap at GAS limit
  
  let threads;
  try {
    threads = GmailApp.search(query, 0, maxResults);
  } catch (e) {
    console.warn(`Email search failed '${query}': ${e.message}`);
    return [];
  }
  
  if (!threads || threads.length === 0) return [];
  
  const results = [];
  const seenThreadIds = new Set();
  
  for (const thread of threads) {
    try {
      // Deduplicate by thread ID
      if (seenThreadIds.has(thread.getId())) continue;
      seenThreadIds.add(thread.getId());
      
      const msgs = thread.getMessages();
      const latest = msgs[msgs.length - 1];
      
      // Determine body length based on batch size
      const bodyLen = threads.length > 30 ? 700 : 
                      threads.length > 15 ? 1500 : 2000;
      
      results.push({
        threadId: thread.getId(),
        from: latest.getFrom(),
        to: latest.getTo() || '',
        subject: latest.getSubject() || '(no subject)',
        body: truncate(latest.getPlainTextBody(), bodyLen),
        date: latest.getDate(),
        snippet: truncate(latest.getPlainTextBody(), 250),
        thread: thread,
        messageCount: msgs.length,
        
        // Include first message info if multiple
        firstMessageFrom: msgs.length > 1 ? msgs[0].getFrom() : null,
        firstMessageDate: msgs.length > 1 ? msgs[0].getDate() : null
      });
      
    } catch (e) {
      console.warn(`Skip broken thread in search: ${e.message}`);
    }
  }
  
  // Sort by date descending (newest first)
  results.sort((a, b) => new Date(b.date) - new Date(a.date));
  
  return results;
}

/**
 * Run multiple search queries and merge/deduplicate results.
 */
function searchEmailsMulti_(queries, maxPerQuery) {
  maxPerQuery = maxPerQuery || 20;
  const seenThreadIds = new Set();
  const allResults = [];
  
  for (const q of queries) {
    try {
      const results = searchEmails_(q, maxPerQuery);
      
      for (const r of results) {
        if (!seenThreadIds.has(r.threadId)) {
          seenThreadIds.add(r.threadId);
          r.searchPurpose = q; // Track which query found it
          allResults.push(r);
        }
      }
    } catch (e) {
      console.warn(`Multi-search query failed "${q}": ${e.message}`);
    }
  }
  
  // Sort by date descending
  allResults.sort((a, b) => new Date(b.date) - new Date(a.date));
  
  return allResults;
}

// ============ SENDING ============

/**
 * Send email FROM Hermes TO user (new thread).
 * @param {string} subject - Email subject
 * @param {string} htmlBody - HTML content (will be sanitized)
 * @param {Object} options - Optional: { name, replyTo }
 */
function sendHermesEmail_(subject, htmlBody, options = {}) {
  const cfg = getConfig();
  
  // Sanitize HTML before sending
  const markedHtml = `${cfg.AGENT_MARKER}\n${stripHtml(htmlBody)}`;
  const fullSubject = `${cfg.BRIEFING_TAG} ${subject}`;
  
  GmailApp.sendEmail(
    cfg.USER_EMAIL,
    fullSubject,
    markedHtml, // Plain text fallback
    {
      htmlBody: sanitizeEmailHtml_(htmlBody),
      name: options.name || 'Hermes',
      replyTo: options.replyTo || null
    }
  );
  
  // Mark as sent in our system
  try {
    const found = GmailApp.search(`subject:"${fullSubject}" newer_than:1h`, 0, 1);
    if (found.length > 0) markProcessed_(found[0]);
  } catch (e) {
    // Non-critical
  }
  
  Utilities.sleep(1500); // Rate limiting courtesy
}

/**
 * Reply in an existing thread (for command responses).
 */
function replyInThread_(thread, htmlBody) {
  const cfg = getConfig();
  const markedHtml = `${cfg.AGENT_MARKER}\n${htmlBody}`;
  
  thread.reply('', markedHtml, {
    htmlBody: sanitizeEmailHtml_(htmlBody),
    name: 'Hermes'
  });
}

/**
 * Send email AS the user (approved draft).
 * Checks send quota first!
 * @param {Object} to - Recipient info { email, name, type }
 * @param {string} subject - Subject line
 * @param {string} body - Body content
 * @param {Object} options - Optional: { cc, bcc, replyTo }
 */
function sendAsUser_(to, subject, body, options = {}) {
  // Safety check: quota
  if (!checkSendQuota_()) {
    throw new Error('Daily send limit reached (safety guardrail)');
  }
  
  const recipientEmail = to.email || to;
  
  GmailApp.sendEmail(recipientEmail, subject, body, {
    htmlBody: sanitizeEmailHtml_(body),
    cc: options.cc || '',
    bcc: options.bcc || '',
    name: options.name || '',
    htmlBody: options.htmlBody || null,
    replyTo: options.replyTo || null
  });
  
  incrementSendCount_();
}

/**
 * Reply as user to specific thread.
 */
function replyAsUser_(thread, body, options = {}) {
  if (!checkSendQuota_()) {
    throw new Error('Daily send limit reached');
  }
  
  thread.reply(body, '', {
    htmlBody: sanitizeEmailHtml_(body),
    ...options
  });
  
  incrementSendCount_();
}

// ============ LABELING & ARCHIVING ============

/**
 * Mark thread as processed (add label).
 */
function markProcessed_(thread) {
  const cfg = getConfig();
  try {
    const label = GmailApp.getUserLabelByName(cfg.PROCESSED_LABEL) ||
                  GmailApp.createLabel(cfg.PROCESSED_LABEL);
    label.addToThread(thread);
  } catch (e) {
    console.warn(`Failed to label thread: ${e.message}`);
  }
}

/**
 * Archive email thread.
 */
function archiveEmail_(threadId) {
  try {
    const thread = GmailApp.getThreadById(threadId);
    if (thread) thread.moveToArchive();
  } catch (e) {
    console.warn(`Archive failed for ${threadId}: ${e.message}`);
  }
}

/**
 * Apply label to email.
 */
function labelEmail_(threadId, labelName, threadObj) {
  try {
    const thread = threadObj || GmailApp.getThreadById(threadId);
    if (!thread) return;
    
    let label = GmailApp.getUserLabelByName(labelName);
    if (!label) label = GmailApp.createLabel(labelName);
    
    label.addToThread(thread);
  } catch (e) {
    console.warn(`Labeling failed: ${e.message}`);
  }
}

// ============ QUOTA MANAGEMENT ============

/**
 * Check if we can still send today.
 */
function checkSendQuota_() {
  const today = todayStr_();
  
  if (getProp('SENDS_DATE') !== today) {
    setProp('SENDS_DATE', today);
    setProp('SENDS_TODAY', '0');
  }
  
  const sentToday = Number(getProp('SENDS_TODAY') || 0);
  const maxDaily = getNumProp('MAX_SEND_PER_DAY', 20);
  
  return sentToday < maxDaily;
}

function incrementSendCount_() {
  const today = todayStr_();
  
  if (getProp('SENDS_DATE') !== today) {
    setProp('SENDS_DATE', today);
    setProp('SENDS_TODAY', '1');
  } else {
    setProp('SENDS_TODAY', String(Number(getProp('SENDS_TODAY') || 0) + 1));
  }
}