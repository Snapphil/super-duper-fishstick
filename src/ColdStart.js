/**
 * HERMES — ColdStart.gs
 * One-time (or rare) initializer: Drive layout under Hermes/, starter wiki, first compile, first briefing.
 * Run initializeHermes() manually from the Apps Script editor after OPENAI_API_KEY is set.
 */

function coldStartGetOrCreateHermesRootFolder_() {
  var rf = DriveApp.getRootFolder();
  var it = rf.getFoldersByName('Hermes');
  if (it.hasNext()) return it.next();
  return rf.createFolder('Hermes');
}

/** Same email object shape as RELAY fetch (no dependency on Tests.gs). */
function coldStartThreadToEmail_(thread) {
  var msgs = thread.getMessages();
  var m = msgs[msgs.length - 1];
  return {
    threadId: thread.getId(),
    messageId: m.getId(),
    from: m.getFrom(),
    to: m.getTo() || '',
    cc: m.getCc() || '',
    subject: m.getSubject() || '(no subject)',
    body: m.getPlainBody() || '',
    htmlBody: m.getBody() || '',
    date: m.getDate(),
    threadSize: msgs.length,
    thread: thread,
    message: m,
    snippet: truncate(m.getPlainBody(), 250)
  };
}

function coldStartFetchInboxEmails_(max) {
  max = max || 20;
  var threads = GmailApp.search('in:inbox newer_than:90d -in:spam -in:trash', 0, max);
  var out = [];
  for (var i = 0; i < threads.length; i++) {
    try {
      out.push(coldStartThreadToEmail_(threads[i]));
    } catch (e) {
      Logger.log('[WARN] coldStartFetchInboxEmails_ skip: ' + e.message);
    }
  }
  return out;
}

function coldStartStarterIndexMd_() {
  return [
    '# Hermes Wiki Index',
    '*Cold start — will refresh after first compile*',
    '',
    '## People',
    '',
    '## Commitments',
    '- [[commitments.md]]',
    ''
  ].join('\n');
}

function coldStartStarterCommitmentsMd_() {
  var t = todayStr_();
  return [
    '# Active Commitments',
    '*Cold start — ' + t + '*',
    '',
    '## Outbound (you owe others)',
    '*(none)*',
    '',
    '## Inbound (others owe you)',
    '*(none)*',
    '',
    '## Stale (30+ days, no follow-up)',
    '*(none)*',
    '',
    '---',
    '*Hermes tracks commitments automatically. Check these weekly.*'
  ].join('\n');
}

/**
 * First-time bootstrap: Hermes/ in My Drive, vault + wiki + raw + logs, schema.md default,
 * process recent inbox mail through the full pipeline, send one briefing, install triggers.
 */
function initializeHermes() {
  try {
    Logger.log('[COLDSTART] (1) validateConfig');
    validateConfig();

    var userEmail = Session.getActiveUser().getEmail();
    setProp('USER_EMAIL', userEmail);
    Logger.log('[COLDSTART] (2) USER_EMAIL=' + userEmail);

    Logger.log('[COLDSTART] (3) Ensure My Drive/Hermes and set ROOT_FOLDER_ID');
    var hermes = coldStartGetOrCreateHermesRootFolder_();
    setProp('ROOT_FOLDER_ID', hermes.getId());
    Logger.log('[COLDSTART]     Hermes folder id=' + hermes.getId());

    Logger.log('[COLDSTART] (4) Hermes/logs');
    mkdirp_('logs', hermes);

    Logger.log('[COLDSTART] (5) setupVault_ (memory, tasks, AGENT.md, schema.md, …)');
    setupVault_();

    Logger.log('[COLDSTART] (6) setupWikiVault_ (wiki/people, wiki/projects)');
    setupWikiVault_();

    Logger.log('[COLDSTART] (7) setupRawVault_ (raw/)');
    setupRawVault_();

    Logger.log('[COLDSTART] (8) Starter wiki/index.md + wiki/commitments.md');
    writeWikiFile_('index.md', coldStartStarterIndexMd_());
    writeWikiFile_('commitments.md', coldStartStarterCommitmentsMd_());

    clearMemoryCache_();

    Logger.log('[COLDSTART] (9) Load last 20 inbox threads (90d window) into pipeline');
    var emails = coldStartFetchInboxEmails_(20);
    Logger.log('[COLDSTART]     threads=' + emails.length);

    if (emails.length > 0) {
      Logger.log('[COLDSTART] (10) runHermesPipelineOnBatch_ (classify, raw, wiki compile, …)');
      var r = runHermesPipelineOnBatch_(emails, { verboseLog: true });
      Logger.log('[COLDSTART]     totalTokens=' + r.totalTokens);
    } else {
      Logger.log('[COLDSTART]     WARN no inbox threads found; wiki unchanged until mail arrives');
    }

    try {
      updateWikiIndex_();
      Logger.log('[COLDSTART] (11) updateWikiIndex_');
    } catch (ix) {
      Logger.log('[COLDSTART] WARN updateWikiIndex_: ' + ix.message);
    }

    Logger.log('[COLDSTART] (12) generateAndSendBriefing_ (sends real email)');
    generateAndSendBriefing_('Cold start');

    Logger.log('[COLDSTART] (13) installChronosTriggers_');
    installChronosTriggers_();

    initializeTheme_();
    setProp('SENDS_TODAY', '0');
    setProp('SENDS_DATE', todayStr_());
    setProp('HERMES_COLDSTART_AT', new Date().toISOString());

    Logger.log('OK initializeHermes finished. Edit Drive: Hermes/schema.md and Hermes/AGENT.md');
  } catch (e) {
    Logger.log('FAIL initializeHermes: ' + e.message);
  }
}
