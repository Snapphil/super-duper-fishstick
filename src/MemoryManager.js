/**
 * HERMES — MemoryManager.gs
 * ============================================
 * PANTHEON SYSTEM: VAULT Controller (Memory Management)
 * 
 * Reads, writes, maintains all persistent state.
 * FIXED: Cache invalidation, atomic operations.
 */

// ============ CACHE LAYER ============

const _fileCache = {};

function clearMemoryCache_() {
  Object.keys(_fileCache).forEach(k => delete _fileCache[k]);
}

// ============ READ OPERATIONS ============

function readMemory(propKey) {
  if (_fileCache[propKey]) return _fileCache[propKey];

  const fieldId = getProp(propKey);
  if (!fieldId) return null;

  try {
    const content = DriveApp.getFileById(fieldId).getBlob().getDataAsString();
    _fileCache[propKey] = content;
    return content;
  } catch (e) {
    Logger.log('[ERROR] Read error ' + propKey + ': ' + e.message);
    return null;
  }
}

function readJson(propKey) {
  const raw = readMemory(propKey);
  if (!raw) return null;
  return safeJsonParse(raw);
}

// ============ WRITE OPERATIONS (ATOMIC) ============

function writeMemory(propKey, content) {
  const fieldId = getProp(propKey);
  if (!fieldId) {
    Logger.log('[ERROR] No File ID for ' + propKey + '. Cannot write.');
    return false;
  }

  try {
    DriveApp.getFileById(fieldId).setContent(content);
    _fileCache[propKey] = content; // Update cache immediately
    return true;
  } catch (e) {
    Logger.log('[ERROR] Write error ' + propKey + ': ' + e.message);
    return false;
  }
}

function writeJson(propKey, data) {
  return writeMemory(propKey, JSON.stringify(data, null, 2));
}

function appendJsonArray(propKey, entry) {
  let arr = readJson(propKey);
  if (!Array.isArray(arr)) arr = [];
  arr.push(entry);
  return writeJson(propKey, arr);
}

function appendJsonArray_(propKey, entry) {
  return appendJsonArray(propKey, entry);
}

// ============ FOLDER / FILE SETUP (Drive) ============

function mkdirp_(name, parent) {
  const search = parent ? parent.getFoldersByName(name) : DriveApp.getFoldersByName(name);
  if (search.hasNext()) return search.next();
  return parent ? parent.createFolder(name) : DriveApp.createFolder(name);
}

function mkfile_(propKey, name, folder, content) {
  const existing = folder.getFilesByName(name);
  let file;
  if (existing.hasNext()) {
    file = existing.next();
  } else {
    file = folder.createFile(name, content);
  }
  setProp(propKey, file.getId());
  return file;
}

// ============ CONVENIENCE READERS ============

function getAgentMd_() { return readMemory('FILE_AGENT_MD') || 'Not configured.'; }

function getPreferences_() { return readJson('FILE_PREFERENCES') || getDefaultPreferences_(); }

function getDefaultPreferences_() {
  return {
    schedule: {
      command_check_minutes: 2,
      process_interval_minutes: 10,
      morning_enabled: true,
      morning_hour: 8,
      midday_enabled: true,
      midday_hour: 13,
      evening_enabled: true,
      evening_hour: 21,
      weekly_enabled: true,
      weekly_hour: 19
    },
    auto_actions: {
      archive_patterns: [],
      label_patterns: [],
      star_patterns: [],
      always_surface_patterns: []
    },
    reply_styles: {},
    classification_overrides: {},
    urgent_interrupt_threshold: 9,
    max_urgent_per_briefing: 3,
    learning: {
      total_classified: 0,
      total_approvals: 0,
      total_rejections: 0,
      total_edits: 0
    }
  };
}

function getDeadlines_() { return readJson('FILE_DEADLINES') || []; }

// ============ UI PREFERENCES (AESTHETE MEMORY) ============

/**
 * Returns the persistent UI preference store.
 * dos/donts are plain-text rules extracted from user feedback.
 * feedback_log is a chronological record for audit/context.
 */
function getUiPrefs_() {
  return readJson('FILE_UI_PREFS') || { dos: [], donts: [], feedback_log: [] };
}

/**
 * Append a parsed UI note to the store.
 * @param {'do'|'dont'|'log'} type
 * @param {string} note  Plain-text rule or observation.
 */
function appendUiNote_(type, note) {
  var prefs = getUiPrefs_();
  var ts = new Date().toISOString();
  if (type === 'do') {
    prefs.dos.push(note);
    if (prefs.dos.length > 30) prefs.dos = prefs.dos.slice(-30);
  } else if (type === 'dont') {
    prefs.donts.push(note);
    if (prefs.donts.length > 30) prefs.donts = prefs.donts.slice(-30);
  }
  prefs.feedback_log.push({ ts: ts, type: type, note: note });
  if (prefs.feedback_log.length > 100) prefs.feedback_log = prefs.feedback_log.slice(-100);
  writeJson('FILE_UI_PREFS', prefs);
}

/**
 * Build a concise UI-prefs summary string for injection into ORACLE prompts.
 */
function getUiPrefsContext_() {
  var prefs = getUiPrefs_();
  var lines = [];
  if (prefs.dos && prefs.dos.length) {
    lines.push('UI DOs: ' + prefs.dos.slice(-10).join(' | '));
  }
  if (prefs.donts && prefs.donts.length) {
    lines.push("UI DON'Ts: " + prefs.donts.slice(-10).join(' | '));
  }
  if (!lines.length) return '(no user UI feedback stored yet)';
  return lines.join('\n');
}

function getPeopleGraph_() {
  const g = readJson('FILE_PEOPLE_GRAPH');
  return g || { nodes: {}, edges: [] };
}

function getPendingApprovals_() { return readJson('FILE_PENDING_APPROVALS') || []; }

function getActiveThreads_() { return readJson('FILE_ACTIVE_THREADS') || []; }

// ============ DEADLINES ============

function addDeadline(data) {
  const deadlines = getDeadlines_();

  // Check duplicate
  const isDupe = deadlines.some(d => d.description === data.description && d.date === data.date);
  if (isDupe) return;

  deadlines.push({
    id: 'dl_' + generatedId_(),
    description: data.description,
    date: data.date,
    category: data.category || 'unknown',
    importance: data.importance || 5,
    source_from: data.source_from || null,
    extracted_on: new Date().toISOString(),
    status: 'active'
  });

  writeJson('FILE_DEADLINES', deadlines);
}

// ============ PENDING APPROVALS ============

function addPendingApproval(approval) {
  const pending = getPendingApprovals_();
  pending.push(approval);
  writeJson('FILE_PENDING_APPROVALS', pending);
  return approval;
}

function findApprovalByShortcode(code) {
  const map = safeJsonParse(getProp('BRIEFING_MAP') || '{}');
  const approvalId = map[String(code)];
  if (!approvalId) return null;

  const pending = getPendingApprovals_();
  return pending.find(p => p.id === approvalId && p.status === 'pending') || null;
}

function updateApprovalStatus(approvalId, newStatus) {
  const pending = getPendingApprovals_();
  const idx = pending.findIndex(p => p.id === approvalId);

  if (idx === -1) return false;

  pending[idx].status = newStatus;
  pending[idx].resolved_at = new Date().toISOString();

  writeJson('FILE_PENDING_APPROVALS', pending);
  return true;
}

function getAllPendingApprovals_() {
  return getPendingApprovals_().filter(p => p.status === 'pending');
}

// ============ PEOPLE GRAPH ============

function lookupPerson(email) {
  const graph = getPeopleGraph_();
  const normalized = email.toLowerCase().trim();

  // Check primary email
  if (graph.nodes[normalized]) return graph.nodes[normalized];

  // Check alternates
  for (const [key, person] of Object.entries(graph.nodes)) {
    if (person.alternate_emails && person.alternate_emails.includes(normalized)) {
      return person;
    }
  }

  return null;
}

function lookupPersonByName(name) {
  if (!name) return null;
  const graph = getPeopleGraph_();
  const lower = name.toLowerCase().trim();

  for (const [email, person] of Object.entries(graph.nodes)) {
    if ((person.name || '').toLowerCase().includes(lower)) return person;
  }

  return null;
}

function upsertPerson(emailAddr, data) {
  const graph = getPeopleGraph_();
  const key = emailAddr.toLowerCase().trim();

  if (!graph.nodes[key]) {
    // New person
    graph.nodes[key] = {
      email: key,
      alternate_emails: [],
      name: data.name || key,
      role: data.role || 'unknown',
      organization: data.organization || '',
      type: data.type || 'unknown',
      tags: data.tags || [],
      importance: data.importance || 5,
      communication_style: data.communication_style || 'unknown',
      first_seen: new Date().toISOString(),
      last_interaction: new Date().toISOString(),
      total_interactions: 0,
      sentiment_trend: 'unknown',
      waiting_on: null,
      notes: data.notes || ''
    };
  } else {
    // Merge - don't overwrite existing fields with null/undefined
    const existing = graph.nodes[key];
    for (const [k, v] of Object.entries(data)) {
      if (v !== null && v !== undefined) {
        existing[k] = v;
      }
    }
    existing.last_interaction = new Date().toISOString();
  }

  graph.nodes[key].total_interactions = (graph.nodes[key].total_interactions || 0) + 1;

  writeJson('FILE_PEOPLE_GRAPH', graph);
  return graph.nodes[key];
}

// ============ MEMORY DIGEST (For Prompts) ============

function getMemoryDigest_() {
  const deadlines = getDeadlines_();
  const graph = getPeopleGraph_();
  const summaries = readJson('FILE_DAILY_SUMMARIES') || {};
  const activeThreads = getActiveThreads_();
  const interactionsData = readJson('FILE_INTERACTIONS') || {};  // FIXED: renamed to avoid shadowing in .map()
  const now = new Date();

  // Deadlines analysis
  const activeDI = deadlines.filter(d => d.status === 'active');
  const overdueDI = activeDI.filter(d => new Date(d.date) < now);
  const upcomingDI = activeDI
    .filter(d => new Date(d.date) >= now)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, 5);

  const overdueLines = overdueDI.length
    ? overdueDI.map(d => `• ${d.description} — ${d.date} (overdue)`).join('\n')
    : '';
  const upcomingLines = upcomingDI.length
    ? upcomingDI.map(d => `• ${d.description} — ${d.date}`).join('\n')
    : '';
  const dfText = [overdueLines, upcomingLines].filter(Boolean).join('\n') || '(No upcoming/overdue deadline lines.)';

  // People
  const people = Object.values(graph.nodes || {})
    .sort((a, b) => (b.importance || 0) - (a.importance || 0))
    .slice(0, 20);

  const peopleText = people.length > 0
    ? people.map(p => {
      const intCount = (interactionsData[p.email] || []).length;  // FIXED: was shadowing outer 'interactions'
      return `${p.name} (${p.email}) — ${p.type} | imp:${p.importance} | interactions: ${intCount}${p.waiting_on ? ` | ⏳ Waiting: ${p.waiting_on}` : ''}`;
    }).join('\n')
    : '(No people tracked yet)';

  // Waiting on
  const waitingOn = people.filter(p => p.waiting_on);
  const waitingText = waitingOn.length > 0
    ? waitingOn.map(p => `⏳ Waiting on ${p.name}: ${p.waiting_on}`).join('\n')
    : ': Not waiting on anyone.';

  // Active threads
  const threadsText = activeThreads.length > 0
    ? activeThreads.slice(0, 10).map(th => `${th.subject || '(no subject)'} (${th.participants?.join(', ') || 'unknown'}) — ${th.status || 'active'}`).join('\n')
    : ': No active threads.';

  // Recent insights
  const recentInsights = Object.values(summaries)
    .filter(s => new Date(s.timestamp) >= new Date(Date.now() - 7 * 864e5))
    .slice(-5);
  const insightsText = recentInsights.length > 0
    ? recentInsights.map(s => `[${truncate(s.question || '', 60)}] → ${truncate(s.key_insight || s.text || '', 100)}`).join('\n')
    : ': No recent research insights.';

  // Learning stats
  const learn = getPreferences_()?.learning || {};

  return {
    full: `
═══ MEMORY: DEADLINES ═══
 ${activeDI.length} active | ${overdueDI.length} overdue | ${upcomingDI.length} upcoming
 ${dfText}

═══ MEMORY: PEOPLE ═══
 ${people.length} tracked
 ${peopleText}

═══ MEMORY: WAITING ON ═══
 ${waitingText}

═══ MEMORY: ACTIVE THREADS ═══
 ${threadsText}

═══ MEMORY: RECENT RESEARCH ═══
 ${insightsText}

═══ MEMORY: LEARNING ═══
Emails classified: ${learn.total_classified || 0}
Drafts approved: ${learn.total_approvals || 0}
Drafts rejected: ${learn.total_rejections || 0}
Drafts edited: ${learn.total_edits || 0}`,

    stats: {
      totalDeadlines: activeDI.length,
      overdueCount: overdueDI.length,   // FIXED: removed duplicate key
      upcomingCount: upcomingDI.length,
      totalPeople: people.length,
      totalThreads: activeThreads.length
    },

    structured: {
      deadlines: activeDI,
      overdue: overdueDI,
      upcoming: upcomingDI,
      people: people.slice(0, 20),
      waitingOn: waitingOn,
      activeThreads: activeThreads.slice(0, 5),
      recentInsights: recentInsights,
      learn: learn
    }
  };
}

// ============ MEMORY UPDATES FROM ACTIONS ============

/**
 * Persist a short research summary for prompts (FILE_DAILY_SUMMARIES).
 */
function updateMemoryFromResearch(question, answerHtml, emails) {
  const summaries = readJson('FILE_DAILY_SUMMARIES') || {};
  const key = 'r_' + generatedId_();
  summaries[key] = {
    timestamp: new Date().toISOString(),
    question: question,
    key_insight: truncate(stripHtml(answerHtml || ''), 500),
    text: truncate(stripHtml(answerHtml || ''), 300),
    email_count: emails ? emails.length : 0
  };
  writeJson('FILE_DAILY_SUMMARIES', summaries);
}

function updateMemoryFromClassification_(email, classification) {
  // Update people graph
  if (classification.sender_email) {
    upsertPerson(classification.sender_email, {
      name: classification.sender_name || classification.sender_email,
      type: classification.sender_type || 'unknown',
      importance: classification.suggested_importance || 5
    });
  }

  // Track deadlines
  if (classification.has_deadline && classification.deadline_date) {
    addDeadline({
      description: classification.deadline_description || classification.summary,
      date: classification.deadline_date,
      category: classification.category,
      importance: classification.urgency_score,
      source_from: email.from
    });
  }

  // Track active thread if needs reply
  if (classification.should_draft_reply && classification.classification === 'needs_reply') {
    const threads = getActiveThreads_();
    const exists = threads.some(th => th.thread_id === email.threadId);

    if (!exists) {
      threads.push({
        thread_id: email.threadId,
        subject: email.subject,
        participants: [extractEmailAddress(email.from)],
        status: 'needs_reply',
        last_activity: email.date,
        needs_action: true,
        summary: classification.summary || '',
        urgency: classification.urgency_score
      });
      writeJson('FILE_ACTIVE_THREADS', threads.slice(-50)); // Keep last 50
    }
  }
}

function updateMemoryFromSend_(approval) {
  // Mark thread as replied
  if (approval.thread_id) {
    const threads = getActiveThreads_();
    const idx = threads.findIndex(th => th.thread_id === approval.thread_id);

    if (idx !== -1) {
      threads[idx].status = 'replied';
      threads[idx].replied_at = new Date().toISOString();
      threads[idx].needs_action = false;
      writeJson('FILE_ACTIVE_THREADS', threads);
    }
  }

  // Update interaction
  if (approval.to) {
    const interactions = readJson('FILE_INTERACTIONS') || {};
    const key = approval.to.toLowerCase();

    if (!interactions[key]) interactions[key] = [];
    interactions[key].push({
      date: new Date().toISOString(),
      type: 'email_sent',
      summary: approval.subject || '',
      sentiment: 'proactive'
    });

    // Keep last 20 per person
    if (interactions[key].length > 20) interactions[key] = interactions[key].slice(-20);

    writeJson('FILE_INTERACTIONS', interactions);

    // Update person's last interaction
    upsertPerson(approval.to, { last_interaction: new Date() });
  }

  // Move to completed
  appendJsonArray_('FILE_COMPLETED', {
    id: approval.id,
    type: approval.type,
    to: approval.to,
    subject: approval.subject,
    sent_at: new Date().toISOString(),
    urgency: approval.urgency
  });
}

// ============ MAINTENANCE ============

function maintainMemory_() {
  clearMemoryCache_();

  // 1. Clean expired deadlines
  cleanupDeadlines_();

  // 2. Clean old resolved threads (>7 days)
  const threads = getActiveThreads_();
  const cutoff = new Date(Date.now() - 7 * 864e5);
  const fresh = threads.filter(t =>
    t.replied_at ? new Date(t.replied_at) >= cutoff : true
  );
  if (fresh.length < threads.length) {
    writeJson('FILE_ACTIVE_THREADS', fresh);
  }

  // 3. Trim daily summaries (keep 90 days)
  const summaries = readJson('FILE_DAILY_SUMMARIES') || {};
  const sumCutoff = new Date(Date.now() - 90 * 864e5);
  let trimmedSum = 0;
  for (const [key, val] of Object.entries(summaries)) {
    if (new Date(val.timestamp) < sumCutoff) {
      delete summaries[key];
      trimmedSum++;
    }
  }
  if (trimmedSum > 0) writeJson('FILE_DAILY_SUMMARIES', summaries);

  // 4. Trim interactions (keep 20 per person)
  const interactions = readJson('FILE_INTERACTIONS') || {};
  for (const [key, arr] of Object.entries(interactions)) {
    if (arr.length > 20) {
      interactions[key] = arr.slice(-20);
    }
  }
  writeJson('FILE_INTERACTIONS', interactions);

  // 5. Trim completed (keep 100)
  const completed = readJson('FILE_COMPLETED') || [];
  if (completed.length > 100) {
    writeJson('FILE_COMPLETED', completed.slice(-100));
  }

  Logger.log('✅ Memory maintenance complete.');
}

function cleanupDeadlines_() {
  const deadlines = getDeadlines_();
  const now = new Date();
  let changed = false;

  for (const d of deadlines) {
    if (d.status === 'active' && new Date(d.date) < now) {
      const daysOverdue = Math.ceil((now - new Date(d.date)) / 864e5);
      if (daysOverdue > 30) {
        d.status = 'expired';
        changed = true;
      }
    }
  }

  if (changed) writeJson('FILE_DEADLINES', deadlines);
}