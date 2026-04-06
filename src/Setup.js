/**
 * HERMES — Setup.gs
 * ============================================
 * PANTHEON SYSTEM: Initial Installation & CHRONOS Scheduler
 */

function setupHermes() {
  console.log('🏗️ Setting up HERMES Pantheon System...');
  
  validateConfig();
  
  // 1. User identity
  const userEmail = Session.getActiveUser().getEmail();
  setProp('USER_EMAIL', userEmail);
  
  // 2. Create VAULT structure
  setupVault_();
  
  // 3. Initialize AESTHETE
  initializeTheme_();
  
  // 4. Install CHRONOS triggers (idempotent)
  installChronosTriggers_();
  
  // 5. Send welcome email
  sendWelcomeEmail_(userEmail);
  
  // 6. Reset daily counters
  setProp('SENDS_TODAY', '0');
  setProp('SENDS_DATE', todayStr_());
  
  console.log('✅ HERMES alive. Edit AGENT.md in Drive to personalize.');
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
  ScriptApp.newTrigger('checkForCommands_')
    .timeBased()
    .everyMinutes(cmdInterval)
    .create();
  
  // 2. Email processor
  const procInterval = clampInterval_(sched.process_interval_minutes || 10);
  ScriptApp.newTrigger('processNewEmails_')
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
  
  console.log(`⏱️ CHRONOS installed: cmd=${cmdInterval}m, proc=${procInterval}m`);
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
    console.log(`🧹 Removed ${removed} old triggers`);
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