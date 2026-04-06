/**
 * HERMES — ProactiveAgent.gs
 * ============================================
 * PANTHEON SYSTEM: Autonomous Background Intelligence
 *
 * Runs on a daily trigger. Hermes researches, synthesizes, and acts
 * without waiting for user commands. Sends proactive email when it
 * does something interesting. Keeps a wiki/research-log.md of all
 * autonomous work so it never repeats itself blindly.
 *
 * Entry point: runProactiveTasks_()
 * Trigger: daily at 06:00 (installed by installChronosTriggers_)
 */

// ============ TASK POOL ============
// Each day Hermes selects the most relevant task from this pool,
// executes it autonomously, then reports what it did.

var PROACTIVE_TASK_TYPES = {
  PROFILE_RESEARCH:  'profile_research',   // Research user from emails → update AGENT.md
  COMMITMENT_AUDIT:  'commitment_audit',   // Surface stale commitments needing follow-up
  RELATIONSHIP_MAP:  'relationship_map',   // Find neglected contacts, map patterns
  PROJECT_SYNTHESIS: 'project_synthesis',  // Deep-dive one active project into wiki
  CONTACT_SPOTLIGHT: 'contact_spotlight',  // Build/refresh a key contact's full profile
  PATTERN_ANALYSIS:  'pattern_analysis',   // Detect email patterns, volume trends
  WIKI_HEALTH:       'wiki_health',        // Find wiki gaps, refresh stale entries
  PRIORITY_SURFACE:  'priority_surface'    // Resurface something important from archives
};

// ============ ENTRY POINT ============

/**
 * CHRONOS daily trigger at 06:00.
 * Picks the most relevant autonomous task, executes it, sends report.
 */
function runProactiveTasks_() {
  var startTime = Date.now();
  clearMemoryCache_();

  Logger.log('[PROACTIVE] Starting daily autonomous tasks...');

  // Check if paused
  var paused = getProp('PAUSED_UNTIL');
  if (paused && new Date(paused) > new Date()) {
    Logger.log('[PROACTIVE] Paused until ' + paused + ', skipping.');
    return;
  }

  var actions = [];
  var researchEntries = [];

  // 0. Rebuild context.md first so every downstream task reads fresh state
  try { updateContextMd_(); } catch (e) { Logger.log('[PROACTIVE] context.md pre-update: ' + e.message); }

  // 0b. Detect and fill knowledge gaps before the main tasks run
  try {
    var gapResult = detectAndFillKnowledgeGaps_();
    if (gapResult && gapResult.filled && gapResult.filled.length > 0) {
      researchEntries.push(todayStr_() + ' | gap_fill | ' + gapResult.filled.join(', '));
    }
  } catch (e) {
    Logger.log('[PROACTIVE] Gap detection failed: ' + e.message);
  }

  // 1. Always run: AGENT.md profile research (most valuable)
  try {
    var profileResult = runProfileResearch_();
    if (profileResult.changed || profileResult.insights.length > 0) {
      actions.push(profileResult);
      researchEntries.push(profileResult.logEntry);
    }
  } catch (e) {
    Logger.log('[PROACTIVE] Profile research failed: ' + e.message);
  }

  // 2. Pick one additional task from the pool based on context
  try {
    var bonusTask = pickBonusTask_();
    Logger.log('[PROACTIVE] Bonus task: ' + bonusTask);

    var bonusResult = null;
    if (bonusTask === PROACTIVE_TASK_TYPES.COMMITMENT_AUDIT) {
      bonusResult = runCommitmentAudit_();
    } else if (bonusTask === PROACTIVE_TASK_TYPES.RELATIONSHIP_MAP) {
      bonusResult = runRelationshipMap_();
    } else if (bonusTask === PROACTIVE_TASK_TYPES.CONTACT_SPOTLIGHT) {
      bonusResult = runContactSpotlight_();
    } else if (bonusTask === PROACTIVE_TASK_TYPES.PATTERN_ANALYSIS) {
      bonusResult = runPatternAnalysis_();
    } else if (bonusTask === PROACTIVE_TASK_TYPES.WIKI_HEALTH) {
      bonusResult = runWikiHealthCheck_();
    }

    if (bonusResult && bonusResult.findings && bonusResult.findings.length > 0) {
      actions.push(bonusResult);
      if (bonusResult.logEntry) researchEntries.push(bonusResult.logEntry);
    }
  } catch (e) {
    Logger.log('[PROACTIVE] Bonus task failed: ' + e.message);
  }

  // 3. Write research log
  if (researchEntries.length > 0) {
    try {
      appendResearchLog_(researchEntries);
    } catch (e) {
      Logger.log('[WARN] Research log update failed: ' + e.message);
    }
  }

  // 4. Send proactive email if anything interesting happened
  if (actions.length > 0 && actions.some(function(a) { return a.sendEmail !== false; })) {
    try {
      sendProactiveReport_(actions);
    } catch (e) {
      Logger.log('[ERROR] Proactive email failed: ' + e.message);
    }
  }

  var elapsed = Math.round((Date.now() - startTime) / 1000);
  Logger.log('[PROACTIVE] Done in ' + elapsed + 's. ' + actions.length + ' action(s) taken.');
}

// ============ TASK: PROFILE RESEARCH ============

/**
 * Research the user's identity from recent emails, compare to AGENT.md,
 * update if new information found, report changes.
 */
function runProfileResearch_() {
  var today = todayStr_();
  var currentAgentMd = getAgentMd_();
  var researchLog = readWikiFile_('research-log.md') || '';

  // Get recent emails as research material
  var recentEmails = searchEmails_('newer_than:14d -in:spam -in:trash', 30);

  if (recentEmails.length === 0) {
    return { changed: false, insights: [], sendEmail: false,
      logEntry: today + ' | profile_research | No recent emails to analyze' };
  }

  var emailContext = recentEmails.slice(0, 20).map(function(e) {
    return 'From: ' + e.from + '\nSubject: ' + e.subject + '\nSnippet: ' + truncate(e.body || e.snippet || '', 200);
  }).join('\n---\n');

  var systemPrompt = [
    'You are Hermes, an AI email agent researching your user from their recent email history.',
    'Your goal: extract facts about the user that would help you serve them better.',
    'These facts go into AGENT.md — the user\'s self-description that you read on every run.',
    '',
    'Extract ONLY things explicitly evident from the emails:',
    '- Their role, job title, company',
    '- Current active projects and what they involve',
    '- Key relationships and how they relate',
    '- Communication patterns (who they respond to fast, what they prioritize)',
    '- Any personal context relevant to their work',
    '',
    'Return JSON only: { "discoveries": [{"field": "role|projects|relationships|patterns|context", "finding": "specific fact", "confidence": "explicit|inferred", "evidence": "brief email quote or subject"}], "agentmd_additions": "new lines to add to AGENT.md, or empty string" }'
  ].join('\n');

  var userPrompt = [
    'CURRENT AGENT.MD:',
    truncate(currentAgentMd, 800),
    '',
    'RECENT EMAIL ACTIVITY (last 14 days, ' + recentEmails.length + ' threads):',
    truncate(emailContext, 3000),
    '',
    'What new facts about the user can you confirm from these emails that are not already in AGENT.md?',
    'Be specific and evidence-based. Infer carefully.'
  ].join('\n');

  var result;
  try {
    result = callOracleJson_('research_synthesis', userPrompt, systemPrompt);
  } catch (e) {
    Logger.log('[PROACTIVE] Profile research ORACLE failed: ' + e.message);
    return { changed: false, insights: [], sendEmail: false,
      logEntry: today + ' | profile_research | ORACLE error: ' + e.message };
  }

  var discoveries = Array.isArray(result.discoveries) ? result.discoveries : [];
  var agentMdAdditions = (result.agentmd_additions || '').trim();

  var changed = false;
  if (agentMdAdditions && agentMdAdditions.length > 10) {
    // Append to AGENT.md
    var newAgentMd = currentAgentMd.trim() + '\n\n## Auto-Researched — ' + today + '\n' + agentMdAdditions;
    try {
      writeMemory('FILE_AGENT_MD', newAgentMd);
      changed = true;
      Logger.log('[PROACTIVE] AGENT.md updated with ' + discoveries.length + ' discoveries.');
    } catch (we) {
      Logger.log('[WARN] Could not write AGENT.md: ' + we.message);
    }
  }

  var logEntry = today + ' | profile_research | ' +
    'Analyzed ' + recentEmails.length + ' emails | ' +
    discoveries.length + ' discoveries | ' +
    (changed ? 'AGENT.md updated' : 'No AGENT.md changes');

  return {
    type: PROACTIVE_TASK_TYPES.PROFILE_RESEARCH,
    changed: changed,
    insights: discoveries,
    agentMdAdditions: agentMdAdditions,
    emailCount: recentEmails.length,
    sendEmail: changed || discoveries.length >= 3,
    logEntry: logEntry
  };
}

// ============ TASK: COMMITMENT AUDIT ============

/**
 * Surface commitments that are stale (7+ days, no follow-up).
 * Draft follow-up emails and queue them for approval.
 */
function runCommitmentAudit_() {
  var today = todayStr_();
  var now = new Date();
  var deadlines = getDeadlines_();
  var commitmentsMd = readWikiFile_('commitments.md') || '';

  // Find overdue + approaching deadlines
  var overdue = deadlines.filter(function(d) {
    return d.status === 'active' && new Date(d.date) < now;
  });
  var approaching = deadlines.filter(function(d) {
    if (d.status !== 'active') return false;
    var dl = new Date(d.date);
    var daysLeft = Math.ceil((dl - now) / 86400000);
    return daysLeft >= 0 && daysLeft <= 3;
  });

  // Find stale commitments from wiki commitments.md (outbound)
  var stalePattern = /- \[ \] (.+)/g;
  var openCommitments = [];
  var m;
  while ((m = stalePattern.exec(commitmentsMd)) !== null) {
    openCommitments.push(m[1]);
  }

  var findings = [];
  if (overdue.length > 0) findings.push(overdue.length + ' overdue deadline(s)');
  if (approaching.length > 0) findings.push(approaching.length + ' deadline(s) within 3 days');
  if (openCommitments.length > 0) findings.push(openCommitments.length + ' open commitment(s) in wiki');

  return {
    type: PROACTIVE_TASK_TYPES.COMMITMENT_AUDIT,
    findings: findings,
    overdue: overdue,
    approaching: approaching,
    openCommitments: openCommitments,
    sendEmail: findings.length > 0,
    logEntry: today + ' | commitment_audit | ' + findings.join(', ')
  };
}

// ============ TASK: RELATIONSHIP MAP ============

/**
 * Identify contacts you haven't emailed in a while + contacts who
 * should get more attention based on importance.
 */
function runRelationshipMap_() {
  var today = todayStr_();
  var graph = getPeopleGraph_();
  var people = Object.values(graph.nodes || {});
  var now = new Date();

  // Find high-importance contacts with no recent interaction
  var neglected = people.filter(function(p) {
    if ((p.importance || 0) < 7) return false;
    if (!p.last_interaction) return true;
    var daysSince = Math.ceil((now - new Date(p.last_interaction)) / 86400000);
    return daysSince > 14;
  }).sort(function(a, b) { return (b.importance || 0) - (a.importance || 0); });

  // Find people you're waiting on
  var waitingOn = people.filter(function(p) { return p.waiting_on; });

  var findings = [];
  if (neglected.length > 0) {
    findings.push(neglected.length + ' high-importance contact(s) not emailed in 14+ days');
  }
  if (waitingOn.length > 0) {
    findings.push('Waiting on ' + waitingOn.length + ' person(s)');
  }

  return {
    type: PROACTIVE_TASK_TYPES.RELATIONSHIP_MAP,
    findings: findings,
    neglected: neglected.slice(0, 5),
    waitingOn: waitingOn,
    sendEmail: findings.length > 0,
    logEntry: today + ' | relationship_map | ' + (findings.join(', ') || 'All relationships healthy')
  };
}

// ============ TASK: CONTACT SPOTLIGHT ============

/**
 * Pick the most important contact with a stale/thin profile and
 * do a deep research pass, updating their wiki/people/*.md file.
 */
function runContactSpotlight_() {
  var today = todayStr_();
  var graph = getPeopleGraph_();
  var people = Object.values(graph.nodes || {});

  // Pick highest-importance person
  var target = people
    .filter(function(p) { return p.importance >= 6 && p.email; })
    .sort(function(a, b) { return (b.importance || 0) - (a.importance || 0); })[0];

  if (!target) {
    return { type: PROACTIVE_TASK_TYPES.CONTACT_SPOTLIGHT, findings: [], sendEmail: false,
      logEntry: today + ' | contact_spotlight | No suitable contact found' };
  }

  // Search all threads with this contact
  var threads = searchEmails_('from:' + target.email + ' OR to:' + target.email, 20);

  if (threads.length === 0) {
    return { type: PROACTIVE_TASK_TYPES.CONTACT_SPOTLIGHT, findings: [], sendEmail: false,
      logEntry: today + ' | contact_spotlight | No threads found for ' + target.email };
  }

  // Run profile compilation for this person
  try {
    compilePeopleProfile_({
      email: target.email,
      name: target.name,
      emails: threads.map(function(t) { return { email: t, classification: {} }; })
    });
  } catch (e) {
    Logger.log('[WARN] Contact spotlight compile failed: ' + e.message);
  }

  var findings = ['Updated profile for ' + target.name + ' (' + threads.length + ' threads analyzed)'];

  return {
    type: PROACTIVE_TASK_TYPES.CONTACT_SPOTLIGHT,
    findings: findings,
    contact: target,
    threadCount: threads.length,
    sendEmail: true,
    logEntry: today + ' | contact_spotlight | ' + target.name + ' | ' + threads.length + ' threads'
  };
}

// ============ TASK: PATTERN ANALYSIS ============

/**
 * Analyze email patterns: volume trends, response time patterns,
 * domains sending more/less, topics rising in frequency.
 */
function runPatternAnalysis_() {
  var today = todayStr_();

  // Fetch recent two weeks vs previous two weeks for trend comparison
  var recent = searchEmails_('newer_than:7d -in:spam -in:trash -label:hermes-processed', 50);
  var older  = searchEmails_('newer_than:14d older_than:7d -in:spam -in:trash', 50);

  if (recent.length < 3) {
    return { type: PROACTIVE_TASK_TYPES.PATTERN_ANALYSIS, findings: [], sendEmail: false,
      logEntry: today + ' | pattern_analysis | Insufficient email volume' };
  }

  // Domain frequency analysis
  function domainOf(from) {
    var m = from.match(/@([\w.-]+)/);
    return m ? m[1].toLowerCase() : 'unknown';
  }

  var recentDomains = {};
  recent.forEach(function(e) {
    var d = domainOf(e.from);
    recentDomains[d] = (recentDomains[d] || 0) + 1;
  });
  var olderDomains = {};
  older.forEach(function(e) {
    var d = domainOf(e.from);
    olderDomains[d] = (olderDomains[d] || 0) + 1;
  });

  // Find spikes
  var spikes = [];
  Object.keys(recentDomains).forEach(function(d) {
    var r = recentDomains[d];
    var o = olderDomains[d] || 0;
    if (r >= 3 && r > o * 1.5) {
      spikes.push(d + ' (' + r + ' emails this week vs ' + o + ' last week)');
    }
  });

  var systemPrompt = [
    'You are Hermes analyzing email patterns for a personal assistant briefing.',
    'Identify 2-3 genuinely interesting patterns worth surfacing to the user.',
    'Be specific, data-backed, and actionable.',
    'Return JSON: {"insights": ["insight 1", "insight 2", ...]}'
  ].join('\n');

  var userPrompt = [
    'Last 7 days: ' + recent.length + ' emails',
    'Previous 7 days: ' + older.length + ' emails',
    'Volume change: ' + (recent.length > older.length ? '+' : '') + (recent.length - older.length),
    '',
    'Domain spikes: ' + (spikes.join('; ') || 'none'),
    '',
    'Recent subjects (sample): ' + recent.slice(0, 10).map(function(e) { return e.subject; }).join(' | '),
    '',
    'What 2-3 patterns are worth surfacing to the user?'
  ].join('\n');

  var result;
  try {
    result = callOracleJson_('research_synthesis', userPrompt, systemPrompt);
  } catch (e) {
    result = { insights: spikes.slice(0, 3) };
  }

  var insights = Array.isArray(result.insights) ? result.insights : spikes.slice(0, 3);

  return {
    type: PROACTIVE_TASK_TYPES.PATTERN_ANALYSIS,
    findings: insights,
    recentCount: recent.length,
    olderCount: older.length,
    spikes: spikes,
    sendEmail: insights.length > 0,
    logEntry: today + ' | pattern_analysis | ' + recent.length + ' recent emails | ' + insights.length + ' insights'
  };
}

// ============ TASK: WIKI HEALTH CHECK ============

/**
 * Scan wiki for gaps (people with thin profiles, commitments not linked
 * to threads, stale index). Run targeted refreshes.
 */
function runWikiHealthCheck_() {
  var today = todayStr_();
  var graph = getPeopleGraph_();
  var people = Object.values(graph.nodes || {});
  var findings = [];

  // Find people with many interactions but no wiki file
  var missingProfiles = people.filter(function(p) {
    if ((p.total_interactions || 0) < 3) return false;
    try {
      var fname = makePersonFilename_(p.name, p.email);
      var existing = readWikiFile_('people/' + fname);
      return !existing || existing.trim().length < 50;
    } catch (e) { return false; }
  });

  if (missingProfiles.length > 0) {
    findings.push(missingProfiles.length + ' contacts with 3+ interactions but thin/missing wiki profiles');
    // Build profiles for up to 3
    missingProfiles.slice(0, 3).forEach(function(p) {
      try {
        var threads = searchEmails_('from:' + p.email + ' OR to:' + p.email, 15);
        if (threads.length > 0) {
          compilePeopleProfile_({
            email: p.email, name: p.name,
            emails: threads.map(function(t) { return { email: t, classification: {} }; })
          });
        }
      } catch (e) { Logger.log('[WARN] Wiki health compile for ' + p.email + ': ' + e.message); }
    });
  }

  // Update wiki index
  try {
    updateWikiIndex_();
    findings.push('Wiki index refreshed');
  } catch (e) {
    Logger.log('[WARN] Wiki index refresh failed: ' + e.message);
  }

  return {
    type: PROACTIVE_TASK_TYPES.WIKI_HEALTH,
    findings: findings,
    sendEmail: missingProfiles.length > 0,
    logEntry: today + ' | wiki_health | ' + (findings.join(' | ') || 'No issues found')
  };
}

// ============ TASK SELECTOR ============

/**
 * Pick the most relevant bonus task based on current system state.
 * Rotates through the pool to avoid repetition.
 */
function pickBonusTask_() {
  var lastTask = getProp('LAST_PROACTIVE_TASK') || '';
  var memory = getMemoryDigest_();

  // Priority logic: context-driven, not pure rotation
  if ((memory.stats.overdueCount || 0) > 0) {
    return PROACTIVE_TASK_TYPES.COMMITMENT_AUDIT;
  }

  // Rotate through remaining tasks based on day of week
  var rotation = [
    PROACTIVE_TASK_TYPES.PATTERN_ANALYSIS,
    PROACTIVE_TASK_TYPES.RELATIONSHIP_MAP,
    PROACTIVE_TASK_TYPES.CONTACT_SPOTLIGHT,
    PROACTIVE_TASK_TYPES.WIKI_HEALTH,
    PROACTIVE_TASK_TYPES.COMMITMENT_AUDIT,
    PROACTIVE_TASK_TYPES.PATTERN_ANALYSIS,
    PROACTIVE_TASK_TYPES.RELATIONSHIP_MAP
  ];

  var dow = new Date().getDay(); // 0=Sun … 6=Sat
  var picked = rotation[dow % rotation.length];

  // Don't repeat same task two days in a row
  if (picked === lastTask && rotation.length > 1) {
    picked = rotation[(dow + 1) % rotation.length];
  }

  setProp('LAST_PROACTIVE_TASK', picked);
  return picked;
}

// ============ RESEARCH LOG ============

/**
 * Append entries to wiki/research-log.md.
 * Format: date | task_type | summary
 */
function appendResearchLog_(entries) {
  if (!entries || entries.length === 0) return;

  var today = todayStr_();
  var existing = readWikiFile_('research-log.md') || '';

  // Trim to last 90 days worth (keep it bounded)
  var lines = existing.split('\n');
  if (lines.length > 500) {
    lines = lines.slice(lines.length - 450);
    existing = lines.join('\n');
  }

  var newSection = '\n## ' + today + '\n' +
    entries.map(function(e) { return '- ' + e; }).join('\n');

  // Avoid duplicate date headers
  if (existing.indexOf('## ' + today) !== -1) {
    // Append under existing date header
    existing = existing.replace(
      '## ' + today,
      '## ' + today + newSection.replace('## ' + today, '')
    );
  } else {
    existing = (existing || '# Research Log\n\n*Hermes autonomous research — append-only*\n').trimRight() + '\n' + newSection;
  }

  writeWikiFile_('research-log.md', existing);
  Logger.log('[RESEARCH-LOG] ' + entries.length + ' entr(ies) written.');
}

/**
 * Read recent research log entries for context injection.
 * Returns last N entries as a string.
 */
function getRecentResearchLog_(maxLines) {
  maxLines = maxLines || 30;
  try {
    var log = readWikiFile_('research-log.md') || '';
    if (!log || log.trim().length < 5) return '(No research log yet)';
    var lines = log.split('\n').filter(function(l) { return l.trim().length > 0; });
    return lines.slice(-maxLines).join('\n');
  } catch (e) {
    return '(Research log unavailable)';
  }
}

// ============ PROACTIVE EMAIL RENDERER ============

/**
 * Send a rich proactive email reporting what Hermes did autonomously.
 */
function sendProactiveReport_(actions) {
  var t = getTheme();
  var today = new Date();

  // Build a data object for FORGE
  var reportData = {
    date: today.toDateString(),
    actions: actions.map(function(a) {
      return {
        type: a.type,
        findings: a.findings || [],
        changed: a.changed || false,
        details: buildActionSummary_(a)
      };
    })
  };

  var systemPrompt = buildHermesPersonaPrompt_();

  var userPrompt = [
    'Write a proactive report email to the user about what you did autonomously today.',
    '',
    'AUTONOMOUS ACTIONS TAKEN:',
    JSON.stringify(reportData, null, 2),
    '',
    'RULES:',
    '- Lead with the most interesting/useful finding.',
    '- For AGENT.md updates: quote what was added.',
    '- For commitment audits: list what needs action.',
    '- For pattern analysis: state the insight plainly.',
    '- Be direct and specific — no filler, no "I am excited to share..."',
    '- Sound like a thoughtful colleague reporting their work, not a bot.',
    '- Keep it under 300 words. Use the active theme colors.',
    '- Output ONLY inner HTML (tables/divs). No <html>/<body> tags.'
  ].join('\n');

  var forgePrompt = buildForgePrompt_('proactive_report', reportData, userPrompt);

  var result;
  try {
    result = callAgent_('email_generation', forgePrompt.userPrompt, forgePrompt.systemPrompt);
  } catch (e) {
    Logger.log('[ERROR] Proactive report generation failed: ' + e.message);
    // Fallback: plain card
    var fallbackBody = actions.map(function(a) {
      return '<strong>' + (a.type || 'task') + '</strong>: ' + (a.findings || []).join('; ');
    }).join('<br>');
    sendHermesEmail_('Daily Research Report', quickCard_('Hermes — Daily Research', fallbackBody));
    return;
  }

  sendHermesEmail_('Daily Research — ' + today.toDateString(), result.text || '');
  Logger.log('[PROACTIVE] Report email sent.');
}

/**
 * Human-readable summary for a single action result.
 * @private
 */
function buildActionSummary_(action) {
  var type = action.type || '';
  if (type === PROACTIVE_TASK_TYPES.PROFILE_RESEARCH) {
    return action.changed
      ? 'Updated AGENT.md with ' + (action.insights || []).length + ' new discoveries from ' + (action.emailCount || 0) + ' emails.'
      : (action.insights || []).length + ' potential insights found, no AGENT.md changes warranted.';
  }
  if (type === PROACTIVE_TASK_TYPES.COMMITMENT_AUDIT) {
    return (action.findings || []).join('. ');
  }
  if (type === PROACTIVE_TASK_TYPES.RELATIONSHIP_MAP) {
    return (action.findings || []).join('. ');
  }
  if (type === PROACTIVE_TASK_TYPES.CONTACT_SPOTLIGHT) {
    return action.contact
      ? 'Deep-dived ' + (action.contact.name || '') + ' — ' + (action.threadCount || 0) + ' threads analyzed.'
      : (action.findings || []).join('. ');
  }
  if (type === PROACTIVE_TASK_TYPES.PATTERN_ANALYSIS) {
    return (action.findings || []).join('. ');
  }
  if (type === PROACTIVE_TASK_TYPES.WIKI_HEALTH) {
    return (action.findings || []).join('. ');
  }
  return (action.findings || []).join('. ');
}
