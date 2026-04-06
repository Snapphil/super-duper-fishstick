/**
 * HERMES — PeopleCompiler.js
 * ============================================
 * PANTHEON SYSTEM: VAULT — People Wiki Compiler (Karpathy Layer)
 *
 * Compiles human-readable .md people profiles in Drive after every email run.
 * Never overwrites — always read-merge-write.
 * Storage: Hermes/wiki/people/{firstname-lastname}.md
 */

// ============ ENTRY POINT ============

/**
 * Called from Main.processNewEmails_ after classification.
 * Takes all classified emails and updates / creates people profiles.
 *
 * @param {Array} classifiedEmails - Array of { email, classification } objects
 */
function updatePeopleProfiles_(classifiedEmails) {
    if (!classifiedEmails || classifiedEmails.length === 0) return;

    Logger.log('[PEOPLE] Compiling profiles for ' + classifiedEmails.length + ' email(s)...');

    // Group by sender email to batch-process each person
    const byPerson = {};
    for (const item of classifiedEmails) {
        const email = item.email || item;
        const senderRaw = email.from || '';
        const senderEmail = extractEmailAddress(senderRaw);
        if (!senderEmail || senderEmail === getConfig().USER_EMAIL) continue;

        if (!byPerson[senderEmail]) {
            byPerson[senderEmail] = {
                email: senderEmail,
                name: extractSenderName_(senderRaw),
                emails: []
            };
        }
        byPerson[senderEmail].emails.push({ email: email, classification: item.classification || item.c || {} });
    }

    for (const senderEmail of Object.keys(byPerson)) {
        try {
            compilePeopleProfile_(byPerson[senderEmail]);
        } catch (e) {
            Logger.log('[WARN] People compile failed for ' + senderEmail + ': ' + e.message);
        }
    }
}

// ============ CORE COMPILER ============

/**
 * Compile or update one person's markdown profile.
 * @param {{ email, name, emails }} personData
 */
function compilePeopleProfile_(personData) {
    const senderEmail = personData.email;
    const senderName = personData.name;

    // 1. Get existing profile markdown (if any)
    const filename = makePersonFilename_(senderName, senderEmail);
    const existing = readWikiFile_('people/' + filename) || '';

    // 2. Ask SCRIBE/ORACLE to extract structured updates from these emails
    const emailSummaries = personData.emails.map(function (item) {
        const e = item.email;
        const c = item.classification || {};
        return [
            'Thread ID: ' + (e.threadId || ''),
            'From: ' + e.from,
            'Subject: ' + e.subject,
            'Date: ' + (e.date ? new Date(e.date).toISOString().split('T')[0] : todayStr_()),
            'Body snippet: ' + truncate(e.body || e.snippet || '', 400),
            'Classification: category=' + (c.category || '?') + ', urgency=' + (c.urgency_score || c.urgency || '?'),
            'Summary: ' + (c.summary || '')
        ].join('\n');
    }).join('\n\n---\n\n');

    const extractionPrompt = buildPeopleExtractionPrompt_(senderEmail, senderName, emailSummaries, existing);

    var extracted;
    try {
        const result = callAgent_(
            'entity_extraction',
            extractionPrompt.userPrompt,
            extractionPrompt.systemPrompt,
            { temperature: 0.1, maxTokens: 1024 }
        );
        extracted = safeJsonParse(result.text) || extractJson_(result.text) || {};
    } catch (e) {
        Logger.log('[WARN] Extraction failed for ' + senderEmail + ': ' + e.message);
        extracted = {};
    }

    // 3. Merge with existing and render new markdown
    const newMd = mergePeopleProfile_(senderEmail, senderName, existing, extracted, personData.emails);

    // 4. Write back
    writeWikiFile_('people/' + filename, newMd);
    Logger.log('[PEOPLE] Updated profile: ' + filename);
}

// ============ PROMPT BUILDER ============

function buildPeopleExtractionPrompt_(email, name, emailSummaries, existingProfile) {
    const today = todayStr_();
    const sys = [
        'You are Hermes, extracting contact intelligence from emails.',
        'CONFIDENCE for every factual item:',
        '- "explicit": the person LITERALLY said/wrote it — include a short supportingQuote copied from the email.',
        '- "inferred": Hermes deduces from patterns/context — supportingQuote must be null or empty (no direct quote).',
        'Today: ' + today,
        '',
        'Return ONLY valid JSON with these keys (all optional, skip if unknown):',
        '{',
        '  "topics": [{"label":"topic text","confidence":"explicit|inferred","supportingQuote":"verbatim or empty"}],',
        '  "communicationStyle": {"text":"description or null","confidence":"explicit|inferred","supportingQuote":"verbatim or empty"},',
        '  "avgReplyTimeDays": number_or_null,',
        '  "notes": [{"text":"observation","confidence":"explicit|inferred","supportingQuote":"verbatim or empty"}],',
        '  "openCommitmentsFromThem": [{"description":"they promised X","confidence":"explicit|inferred","supportingQuote":"verbatim or empty","threadId":"must match a Thread ID from the email blocks"}],',
        '  "interactionLines": [{"summary":"one line what happened","confidence":"explicit|inferred","supportingQuote":"verbatim or empty"}],',
        '  "organizationHint": {"text":"company or role","confidence":"explicit|inferred","supportingQuote":"verbatim or empty"}',
        '}',
        '',
        'interactionLines MUST have the SAME length and order as the email blocks in NEW EMAIL INTERACTIONS (one per block).',
        'If you cannot align, return interactionLines as [] and the system will fall back.'
    ].join('\n');

    const user = [
        'CONTACT: ' + name + ' <' + email + '>',
        '',
        'EXISTING PROFILE:',
        existingProfile ? truncate(existingProfile, 1000) : '(none — new contact)',
        '',
        'NEW EMAIL INTERACTIONS:',
        truncate(emailSummaries, 2000)
    ].join('\n');

    return { systemPrompt: sys, userPrompt: user };
}

// ============ PROFILE MERGER / RENDERER ============

/**
 * Merge SCRIBE extraction with existing profile and render final markdown.
 */
function mergePeopleProfile_(email, name, existing, extracted, emails) {
    const today = todayStr_();

    // Parse existing structured data if present
    var totalInteractions = parseExistingInteractionCount_(existing);
    totalInteractions += emails.length;

    // Topics: merge old + new (supports legacy string list or structured)
    var existingTopics = parseExistingTopics_(existing);
    var newTopics = normalizePeopleTopics_(extracted.topics);
    var mergedTopics = mergeUnique_(existingTopics, newTopics).slice(0, 10);

    // Communication style
    var commStyle = formatStyleField_(extracted.communicationStyle, parseExistingField_(existing, 'Communication Style') || 'Unknown');

    // Notes
    var existingNotes = parseExistingNotes_(existing);
    var noteObjs = normalizePeopleNotes_(extracted.notes);
    for (var ni = 0; ni < noteObjs.length; ni++) {
        var nline = formatNoteLine_(today, noteObjs[ni]);
        if (nline && existingNotes.indexOf(nline) === -1) existingNotes.push(nline);
    }
    existingNotes = existingNotes.slice(-10);

    // Interaction history — LLM-tagged lines + Gmail source per email
    var historyLines = buildHistoryLinesFromExtraction_(emails, today, extracted.interactionLines);
    var existingHistory = parseExistingHistory_(existing);
    var mergedHistory = existingHistory.concat(historyLines).slice(-20);

    // Open commitments from them (with thread source)
    var inboundCommitments = normalizeOpenCommitmentsFromThem_(extracted.openCommitmentsFromThem, emails);

    // Relationship strength (simple heuristic)
    var strength = totalInteractions >= 10 ? 'strong' : totalInteractions >= 3 ? 'growing' : 'new';

    // Build markdown
    var lines = [
        '# ' + name,
        '**Email:** ' + email,
        '**Last contact:** ' + today,
        '**Total interactions:** ' + totalInteractions,
        '**Relationship:** ' + strength,
        formatOrgHintLine_(extracted.organizationHint),
        '',
        '## Communication Style',
        commStyle,
        '',
        '## Key Topics',
        mergedTopics.length ? mergedTopics.map(function (t) { return '- ' + t; }).join('\n') : '- (none tracked yet)',
        ''
    ];

    if (inboundCommitments.length) {
        lines.push('## They Owe You');
        inboundCommitments.forEach(function (c) {
            lines.push(c.mainLine);
            if (c.quoteLine) lines.push(c.quoteLine);
        });
        lines.push('');
    }

    if (existingNotes.length) {
        lines.push('## Observations');
        existingNotes.forEach(function (n) { lines.push('- ' + n); });
        lines.push('');
    }

    lines.push('## Interaction History');
    mergedHistory.forEach(function (h) { lines.push('- ' + h); });
    lines.push('');

    lines.push('---');
    lines.push('*Last compiled: ' + today + ' by Hermes*');

    return lines.filter(function (l) { return l !== null; }).join('\n');
}

// ============ MARKDOWN PARSERS (for merge-not-overwrite) ============

function parseExistingInteractionCount_(md) {
    if (!md) return 0;
    var m = md.match(/\*\*Total interactions:\*\*\s*(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
}

function parseExistingTopics_(md) {
    if (!md) return [];
    var section = extractSection_(md, 'Key Topics');
    if (!section) return [];
    var matches = section.match(/^- (.+)$/gm) || [];
    return matches.map(function (l) { return l.replace(/^- /, '').trim(); })
        .filter(function (t) { return t && t !== '(none tracked yet)'; });
}

function parseExistingField_(md, heading) {
    if (!md) return null;
    var idx = md.indexOf('## ' + heading);
    if (idx === -1) return null;
    var after = md.substring(idx + heading.length + 3).trim();
    var end = after.indexOf('\n##');
    return end > 0 ? after.substring(0, end).trim() : after.split('\n')[0].trim();
}

function parseExistingNotes_(md) {
    if (!md) return [];
    var section = extractSection_(md, 'Observations');
    if (!section) return [];
    var matches = section.match(/^- (.+)$/gm) || [];
    return matches.map(function (l) { return l.replace(/^- /, '').trim(); });
}

function parseExistingHistory_(md) {
    if (!md) return [];
    var section = extractSection_(md, 'Interaction History');
    if (!section) return [];
    var matches = section.match(/^- (.+)$/gm) || [];
    return matches.map(function (l) { return l.replace(/^- /, '').trim(); });
}

function extractSection_(md, heading) {
    var start = md.indexOf('## ' + heading);
    if (start === -1) return null;
    var after = md.substring(start + heading.length + 3);
    var end = after.indexOf('\n## ');
    return end > 0 ? after.substring(0, end) : after;
}

/**
 * Build interaction history lines using model-provided confidence + Gmail thread source.
 * @param {Array} emails same order as interactionLines
 * @param {Array|null} interactionLines from extraction JSON
 */
function buildHistoryLinesFromExtraction_(emails, today, interactionLines) {
    var lines = [];
    for (var i = 0; i < emails.length; i++) {
        var item = emails[i];
        var e = item.email;
        var c = item.classification || {};
        var dateStr = e.date ? new Date(e.date).toISOString().split('T')[0] : today;
        var il = Array.isArray(interactionLines) ? interactionLines[i] : null;
        var summary = (il && il.summary) ? il.summary : (c.summary || e.subject || '(email)');
        var conf = (il && String(il.confidence).toLowerCase() === 'explicit') ? 'explicit' : 'inferred';
        if (conf === 'explicit' && il && (!il.supportingQuote || String(il.supportingQuote).trim().length < 2)) {
            conf = 'inferred';
        }
        var url = gmailThreadUrl_(e.threadId || '');
        var tail = url ? ' [' + conf + '] — [source](' + url + ')' : ' [' + conf + ']';
        lines.push(dateStr + ': ' + truncate(summary, 100) + tail);
    }
    return lines;
}

function normalizePeopleTopics_(topics) {
    if (!Array.isArray(topics)) return [];
    var out = [];
    for (var i = 0; i < topics.length; i++) {
        var t = topics[i];
        if (typeof t === 'string') {
            out.push(t);
        } else if (t && t.label) {
            var conf = String(t.confidence || 'inferred').toLowerCase() === 'explicit' ? 'explicit' : 'inferred';
            out.push(t.label + ' [' + conf + ']');
        }
    }
    return out;
}

function normalizePeopleNotes_(notes) {
    if (!notes) return [];
    if (typeof notes === 'string') return [{ text: notes, confidence: 'inferred', supportingQuote: '' }];
    if (!Array.isArray(notes)) return [];
    return notes;
}

function formatNoteLine_(today, noteObj) {
    if (!noteObj || !noteObj.text) return null;
    var conf = String(noteObj.confidence || 'inferred').toLowerCase() === 'explicit' ? 'explicit' : 'inferred';
    if (conf === 'explicit' && (!noteObj.supportingQuote || String(noteObj.supportingQuote).trim().length < 2)) {
        conf = 'inferred';
    }
    return today + ': ' + noteObj.text + ' [' + conf + ']';
}

function formatStyleField_(style, fallback) {
    if (!style) return fallback;
    if (typeof style === 'string') return style;
    if (style.text) return style.text;
    return fallback;
}

function formatOrgHintLine_(hint) {
    if (!hint) return null;
    if (typeof hint === 'string') return '**Organization:** ' + hint;
    if (hint.text) return '**Organization:** ' + hint.text;
    return null;
}

function normalizeOpenCommitmentsFromThem_(raw, emails) {
    var list = Array.isArray(raw) ? raw : [];
    var fallbackTid = emails && emails[0] && emails[0].email ? emails[0].email.threadId : '';
    var out = [];
    for (var i = 0; i < list.length; i++) {
        var it = list[i];
        var desc = typeof it === 'string' ? it : (it.description || it.text || '');
        if (!desc || desc.length < 3) continue;
        var conf = String((typeof it === 'object' ? it.confidence : '') || 'inferred').toLowerCase() === 'explicit' ? 'explicit' : 'inferred';
        var quote = typeof it === 'object' ? String(it.supportingQuote || '').trim() : '';
        var tid = typeof it === 'object' ? String(it.threadId || '').trim() : '';
        if (!tid) tid = fallbackTid;
        if (conf === 'explicit' && quote.length < 2) conf = 'inferred';
        var url = gmailThreadUrl_(tid);
        var parts = [desc, '[' + conf + ']'];
        if (url) parts.push('[source](' + url + ')');
        var mainLine = '- [ ] ' + parts.join(' \u2014 ');
        var quoteLine = conf === 'explicit' ? formatCommitmentQuoteLine_(quote) : '';
        out.push({ mainLine: mainLine, quoteLine: quoteLine });
    }
    return out;
}

function mergeUnique_(arr1, arr2) {
    var seen = {};
    var result = [];
    arr1.concat(arr2).forEach(function (item) {
        var k = (item || '').toLowerCase().trim();
        if (k && !seen[k]) { seen[k] = true; result.push(item); }
    });
    return result;
}

// ============ HELPERS ============

function extractSenderName_(from) {
    if (!from) return 'Unknown';
    // "First Last <email>" or "email"
    var m = from.match(/^"?([^"<]+)"?\s*</);
    if (m) return m[1].trim();
    var email = extractEmailAddress(from);
    // Capitalize local part of email
    var local = email.split('@')[0].replace(/[._-]+/g, ' ');
    return local.split(' ').map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(' ');
}

function makePersonFilename_(name, email) {
    if (name && name !== 'Unknown') {
        return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + '.md';
    }
    return email.split('@')[0].replace(/[^a-z0-9]/g, '-') + '.md';
}

// ============ WIKI I/O ============

/**
 * Read a file from the Hermes wiki folder.
 * @param {string} relativePath - e.g. 'people/sarah-chen.md'
 * @returns {string|null}
 */
function readWikiFile_(relativePath) {
    try {
        var wikiFolder = getWikiFolder_();
        if (!wikiFolder) return null;
        var parts = relativePath.split('/');
        var folder = wikiFolder;
        for (var i = 0; i < parts.length - 1; i++) {
            var sub = folder.getFoldersByName(parts[i]);
            if (!sub.hasNext()) return null;
            folder = sub.next();
        }
        var filename = parts[parts.length - 1];
        var files = folder.getFilesByName(filename);
        if (!files.hasNext()) return null;
        return files.next().getBlob().getDataAsString();
    } catch (e) {
        Logger.log('[WARN] readWikiFile_ ' + relativePath + ': ' + e.message);
        return null;
    }
}

/**
 * Write (create or update) a file in the wiki folder.
 * @param {string} relativePath - e.g. 'people/sarah-chen.md'
 * @param {string} content - Markdown string
 */
function writeWikiFile_(relativePath, content) {
    try {
        var wikiFolder = getWikiFolder_();
        if (!wikiFolder) {
            wikiFolder = setupWikiVault_();
        }
        var parts = relativePath.split('/');
        var folder = wikiFolder;
        for (var i = 0; i < parts.length - 1; i++) {
            var sub = folder.getFoldersByName(parts[i]);
            folder = sub.hasNext() ? sub.next() : folder.createFolder(parts[i]);
        }
        var filename = parts[parts.length - 1];
        var files = folder.getFilesByName(filename);
        if (files.hasNext()) {
            files.next().setContent(content);
        } else {
            folder.createFile(filename, content, MimeType.PLAIN_TEXT);
        }
    } catch (e) {
        Logger.log('[ERROR] writeWikiFile_ ' + relativePath + ': ' + e.message);
    }
}

/**
 * Get the Hermes wiki root folder from Drive.
 */
function getWikiFolder_() {
    var wikiId = getProp('WIKI_FOLDER_ID');
    if (wikiId) {
        try { return DriveApp.getFolderById(wikiId); } catch (e) { }
    }
    // Fallback: search by name
    var cfg = getConfig();
    var root = cfg.ROOT_FOLDER_ID
        ? DriveApp.getFolderById(cfg.ROOT_FOLDER_ID)
        : DriveApp.getRootFolder();
    var sub = root.getFoldersByName('wiki');
    if (sub.hasNext()) {
        var folder = sub.next();
        setProp('WIKI_FOLDER_ID', folder.getId());
        return folder;
    }
    return null;
}
