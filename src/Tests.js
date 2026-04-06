/**
 * HERMES — Tests.gs
 * Manual test runners for the Apps Script editor (Run → select function).
 * Each test catches errors and logs clearly; failures do not throw to the editor.
 */

function tests_logChunks_(prefix, text, maxLen) {
  maxLen = maxLen || 1500;
  var s = String(text || '');
  var i = 0;
  var part = 0;
  while (i < s.length) {
    Logger.log(prefix + ' [' + part + '] ' + s.substring(i, i + maxLen));
    i += maxLen;
    part++;
  }
}

/**
 * Build the same email object shape as fetchUnprocessedEmails_().
 */
function tests_threadToEmail_(thread) {
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

function tests_searchToEmails_(query, max) {
  max = max || 5;
  var threads = GmailApp.search(query, 0, max);
  var out = [];
  for (var i = 0; i < threads.length; i++) {
    try {
      out.push(tests_threadToEmail_(threads[i]));
    } catch (e) {
      Logger.log('[WARN] tests_searchToEmails_ skip thread: ' + e.message);
    }
  }
  return out;
}

// ============ Test 1 ============

function test_emailAccess() {
  try {
    var threads = GmailApp.getInboxThreads(0, 5);
    for (var i = 0; i < threads.length; i++) {
      var msg = threads[i].getMessages()[0];
      Logger.log('FROM: ' + msg.getFrom());
      Logger.log('SUBJECT: ' + msg.getSubject());
      Logger.log('DATE: ' + msg.getDate());
      Logger.log('---');
    }
    Logger.log('OK Gmail access works. Found ' + threads.length + ' threads.');
  } catch (e) {
    Logger.log('FAIL test_emailAccess: ' + e.message);
  }
}

// ============ Test 2 ============

function test_llmConnection() {
  try {
    var result = callAgent_(
      'quick_lookup',
      'Reply with exactly one line: OK_HERMES_LLM',
      'You are a connectivity test. Output only: OK_HERMES_LLM',
      { maxTokens: 64, temperature: 0 }
    );
    Logger.log('LLM raw response: ' + (result.text || '(empty)'));
    Logger.log('agentUsed=' + (result.agentUsed || '') + ' tokens=' + (result.tokens || 0));
    if (result.text && result.text.indexOf('OK_HERMES_LLM') !== -1) {
      Logger.log('OK OpenAI API key and callAgent_ work.');
    } else {
      Logger.log('WARN Response did not contain expected token; check model output above.');
    }
  } catch (e) {
    Logger.log('FAIL test_llmConnection: ' + e.message);
  }
}

// ============ Test 3 ============

function test_driveVault() {
  try {
    var root = DriveApp.getRootFolder();
    var hermesIt = root.getFoldersByName('Hermes');
    var hermesFolder;
    if (hermesIt.hasNext()) {
      hermesFolder = hermesIt.next();
      Logger.log('STEP: Hermes folder exists id=' + hermesFolder.getId());
    } else {
      hermesFolder = root.createFolder('Hermes');
      Logger.log('STEP: Created Hermes folder id=' + hermesFolder.getId());
    }

    var ts = new Date().toISOString();
    var content = 'Hermes test file — ' + ts;
    var file = hermesFolder.createFile('test.md', content, MimeType.PLAIN_TEXT);
    Logger.log('STEP: Created test.md id=' + file.getId());

    var readBack = file.getBlob().getDataAsString();
    Logger.log('STEP: Read back length=' + readBack.length + ' text=' + readBack);

    file.setTrashed(true);
    Logger.log('STEP: test.md moved to trash (deleted for test purposes).');
    Logger.log('OK test_driveVault completed.');
  } catch (e) {
    Logger.log('FAIL test_driveVault: ' + e.message);
  }
}

// ============ Test 4 ============

function test_classifySingle() {
  try {
    var threads = GmailApp.search('is:unread newer_than:30d -in:spam -in:trash', 0, 1);
    if (!threads || threads.length === 0) {
      Logger.log('SKIP test_classifySingle: no unread threads found in window.');
      return;
    }
    var email = tests_threadToEmail_(threads[0]);
    var schema = getParsedSchema_();
    var c = callScribeClassify_(email, buildClassificationPrompt_(schema));
    Logger.log('category: ' + (c.category || ''));
    Logger.log('urgency_score: ' + (c.urgency_score != null ? c.urgency_score : ''));
    Logger.log('importance: ' + (c.importance != null ? c.importance : ''));
    Logger.log('needs_reply: ' + String(c.needs_reply));
    Logger.log('should_draft_reply: ' + String(c.should_draft_reply));
    Logger.log('summary: ' + (c.summary || ''));
    Logger.log('suggested_action: ' + (c.suggested_action || ''));
    Logger.log('suggested_label: ' + (c.suggested_label || ''));
    Logger.log('sender_type: ' + (c.sender_type || ''));
    Logger.log('extracted_deadline: ' + (c.extracted_deadline || ''));
    Logger.log('OK test_classifySingle done.');
  } catch (e) {
    Logger.log('FAIL test_classifySingle: ' + e.message);
  }
}

// ============ Test 5 ============

function test_peopleCompile() {
  try {
    var emails = tests_searchToEmails_('in:inbox newer_than:30d -in:spam -in:trash', 5);
    if (emails.length === 0) {
      Logger.log('SKIP test_peopleCompile: no inbox threads.');
      return;
    }
    var schema = getParsedSchema_();
    var classPrompt = buildClassificationPrompt_(schema);
    var items = [];
    for (var i = 0; i < emails.length; i++) {
      var em = emails[i];
      var c;
      if (isMutedSender_(em, schema.mutedSenders)) {
        c = { category: 'muted', summary: '(muted)' };
      } else {
        c = callScribeClassify_(em, classPrompt);
        applyPriorityContactBoost_(em, c, schema.priorityContacts || []);
      }
      items.push({ email: em, classification: c });
      Logger.log('[people test] classified: ' + (em.subject || '') + ' -> ' + (c.category || ''));
    }
    updatePeopleProfiles_(items.filter(function (x) {
      return x.classification && x.classification.category !== 'muted';
    }));

    var wiki = getWikiFolder_();
    if (!wiki) {
      Logger.log('WARN wiki folder missing; run setupHermes or initializeHermes.');
      return;
    }
    var pf = wiki.getFoldersByName('people');
    if (!pf.hasNext()) {
      Logger.log('OK People compile ran; no people subfolder yet.');
      return;
    }
    var peopleFolder = pf.next();
    var it = peopleFolder.getFiles();
    var names = [];
    while (it.hasNext()) {
      names.push(it.next().getName());
    }
    names.sort();
    Logger.log('wiki/people files (' + names.length + '): ' + names.join(', '));
    Logger.log('OK test_peopleCompile done.');
  } catch (e) {
    Logger.log('FAIL test_peopleCompile: ' + e.message);
  }
}

// ============ Test 6 ============

function test_commitmentExtract() {
  try {
    var emails = tests_searchToEmails_('in:inbox newer_than:30d -in:spam -in:trash', 5);
    if (emails.length === 0) {
      Logger.log('SKIP test_commitmentExtract: no inbox threads.');
      return;
    }
    for (var i = 0; i < emails.length; i++) {
      var em = emails[i];
      var list = extractCommitmentsFromEmail_(em, {});
      Logger.log('--- ' + (em.subject || '') + ' commitments: ' + (list ? list.length : 0));
      if (list && list.length) {
        Logger.log(JSON.stringify(list));
      }
    }
    var schema = getParsedSchema_();
    var classPrompt = buildClassificationPrompt_(schema);
    var batch = [];
    for (var j = 0; j < emails.length; j++) {
      var e2 = emails[j];
      var c2 = isMutedSender_(e2, schema.mutedSenders)
        ? { category: 'muted' }
        : callScribeClassify_(e2, classPrompt);
      batch.push({ email: e2, classification: c2 });
    }
    extractCommitments_(batch.filter(function (x) {
      return x.classification && x.classification.category !== 'muted';
    }));

    var md = readWikiFile_('commitments.md') || '(file missing)';
    tests_logChunks_('commitments.md', md, 1800);
    Logger.log('OK test_commitmentExtract done.');
  } catch (e) {
    Logger.log('FAIL test_commitmentExtract: ' + e.message);
  }
}

// ============ Test 7 ============

function test_rawCapture() {
  try {
    if (typeof captureRawEmails_ !== 'function') {
      Logger.log('RawCapture not implemented yet');
      return;
    }
    var emails = tests_searchToEmails_('in:inbox newer_than:14d -in:spam -in:trash', 3);
    if (emails.length === 0) {
      Logger.log('SKIP test_rawCapture: no threads.');
      return;
    }
    captureRawEmails_(emails);
    var rawRoot = getRawFolder_();
    if (!rawRoot) {
      Logger.log('WARN raw folder not resolved');
      return;
    }
    var dayName = todayStr_();
    var subIt = rawRoot.getFoldersByName(dayName);
    if (!subIt.hasNext()) {
      Logger.log('No raw/' + dayName + ' folder (files may use different date if empty batch earlier).');
    } else {
      var dayFolder = subIt.next();
      var files = dayFolder.getFiles();
      var n = 0;
      while (files.hasNext()) {
        var f = files.next();
        Logger.log('raw file: raw/' + dayName + '/' + f.getName());
        n++;
      }
      Logger.log('Listed ' + n + ' file(s) under raw/' + dayName + '/');
    }
    Logger.log('OK test_rawCapture done.');
  } catch (e) {
    Logger.log('FAIL test_rawCapture: ' + e.message);
  }
}

// ============ Test 8 ============

function test_briefingDry() {
  try {
    var emails = tests_searchToEmails_('in:inbox newer_than:14d -in:spam -in:trash', 10);
    var queuedEmails = [];
    var schema = getParsedSchema_();
    var classPrompt = buildClassificationPrompt_(schema);
    for (var i = 0; i < emails.length; i++) {
      var em = emails[i];
      var c = isMutedSender_(em, schema.mutedSenders)
        ? { category: 'muted', summary: '(muted)', urgency_score: 1, importance: 1, should_draft_reply: false }
        : callScribeClassify_(em, classPrompt);
      queuedEmails.push({
        from: em.from,
        subject: em.subject,
        classification: c,
        action: 'dry_run'
      });
    }

    var memory = getMemoryDigest_();
    var pending = getAllPendingApprovals_();
    var commitmentsMd = readWikiFile_('commitments.md') || '';

    var briefingData = {
      label: 'DRY RUN (not sent)',
      timestamp: new Date().toISOString(),
      queuedEmails: queuedEmails.slice(-15),
      pendingApprovals: pending.length,
      memoryStats: memory.stats,
      deadlines: (memory.structured || {}).upcoming || [],
      overdue: (memory.structured || {}).overdue || [],
      commitmentsSummary: truncate(commitmentsMd, 800)
    };

    var prompt = buildForgePrompt_(
      'daily_briefing',
      briefingData,
      'Create a crisp briefing. Highlight: pending approvals, overdue items, commitment deadlines. Keep under 400 words. This is a test — do not reference sending email.'
    );
    var result = callAgent_('email_generation', prompt.userPrompt, prompt.systemPrompt);
    var htmlBody = result.text || '<p>Briefing generation failed.</p>';
    tests_logChunks_('BRIEFING_DRY_HTML', htmlBody, 1500);
    Logger.log('OK test_briefingDry done (no email sent).');
  } catch (e) {
    Logger.log('FAIL test_briefingDry: ' + e.message);
  }
}

// ============ Test 9 ============

function test_schemaLoad() {
  try {
    var raw = readSchemaMd_();
    if (!raw || !String(raw).trim()) {
      Logger.log('schema.md not wired up yet');
      Logger.log('(Fix: run setupHermes() or initializeHermes() so FILE_SCHEMA_MD / schema.md exists in Drive.)');
      return;
    }
    Logger.log('OK schema.md found, length=' + raw.length);
    var p = parseHermesSchemaMd_(raw);
    Logger.log('priorityContacts: ' + JSON.stringify(p.priorityContacts || []));
    Logger.log('mutedSenders: ' + JSON.stringify(p.mutedSenders || []));
    if (p.communicationStyle) {
      tests_logChunks_('communicationStyle', p.communicationStyle, 1200);
    }
    Logger.log('OK test_schemaLoad done.');
  } catch (e) {
    Logger.log('FAIL test_schemaLoad: ' + e.message);
  }
}

// ============ Test 10 ============

function test_wikiLint() {
  try {
    if (typeof runWikiLint_ !== 'function') {
      Logger.log('WikiLint not implemented yet');
      return;
    }
    runWikiLint_();
    var report = readWikiFile_('lint-report.md') || '(no report written)';
    tests_logChunks_('LINT_REPORT', report, 1500);
    Logger.log('OK test_wikiLint done.');
  } catch (e) {
    Logger.log('FAIL test_wikiLint: ' + e.message);
  }
}

// ============ Test 11 ============

function test_fullPipeline() {
  try {
    clearMemoryCache_();
    var emails = tests_searchToEmails_('in:inbox newer_than:30d -in:spam -in:trash', 3);
    if (emails.length === 0) {
      Logger.log('SKIP test_fullPipeline: no threads.');
      return;
    }
    Logger.log('--- full pipeline on ' + emails.length + ' email(s) ---');
    var r = runHermesPipelineOnBatch_(emails, { verboseLog: true });
    Logger.log('totalTokens=' + r.totalTokens);
    for (var i = 0; i < r.results.length; i++) {
      var row = r.results[i];
      if (row.error) {
        Logger.log('RESULT err: ' + row.error + ' | ' + (row.subject || ''));
      } else {
        var cl = row.classification || {};
        Logger.log('RESULT: ' + (row.subject || '') + ' | cat=' + (cl.category || '') + ' action=' + (row.action || ''));
      }
    }
    Logger.log('compilationInput rows (non-muted): ' + (r.compilationInput ? r.compilationInput.length : 0));
    Logger.log('OK test_fullPipeline done (see wiki/people and wiki/commitments and raw/).');
  } catch (e) {
    Logger.log('FAIL test_fullPipeline: ' + e.message);
  }
}
