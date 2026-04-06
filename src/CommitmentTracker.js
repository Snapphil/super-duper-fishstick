/**
 * HERMES — CommitmentTracker.js
 * ============================================
 * PANTHEON SYSTEM: VAULT — Commitment Compiler (Karpathy Layer)
 *
 * Extracts promises, deadlines, and action items from every email run.
 * Maintains wiki/commitments.md  —  a human-readable, Obsidian-compatible file.
 *
 * Commitment types:
 *   outbound: YOU promised something
 *   inbound:  THEY promised something to you
 *
 * Confidence:
 *   explicit: "I'll send you...", "By Friday..."
 *   inferred: tone/context suggests an obligation
 */

// ============ ENTRY POINT ============

/**
 * Called from Main.processNewEmails_ after classification.
 * Extracts commitments from the batch and updates commitments.md.
 *
 * @param {Array} classifiedEmails - Array of { email, classification } objects
 */
function extractCommitments_(classifiedEmails) {
    if (!classifiedEmails || classifiedEmails.length === 0) return;

    Logger.log('[COMMITMENTS] Scanning ' + classifiedEmails.length + ' email(s) for commitments...');

    var newCommitments = [];

    for (var i = 0; i < classifiedEmails.length; i++) {
        var item = classifiedEmails[i];
        var email = item.email || item;
        var classification = item.classification || item.c || {};

        // Skip noise / newsletters — unlikely to have commitments
        if (classification.category === 'noise' || classification.category === 'newsletter') continue;

        try {
            var extracted = extractCommitmentsFromEmail_(email, classification);
            if (extracted && extracted.length > 0) {
                newCommitments = newCommitments.concat(extracted);
            }
        } catch (e) {
            Logger.log('[WARN] Commitment extraction failed for "' + (email.subject || '') + '": ' + e.message);
        }
    }

    if (newCommitments.length === 0) {
        Logger.log('[COMMITMENTS] No new commitments found.');
        return;
    }

    // Read existing commitments file, merge, write back
    var existingMd = readWikiFile_('commitments.md') || '';
    var updatedMd = mergeCommitmentsIntoMd_(existingMd, newCommitments);
    writeWikiFile_('commitments.md', updatedMd);

    // Also update wiki index
    updateWikiIndex_();

    Logger.log('[COMMITMENTS] Added ' + newCommitments.length + ' commitment(s) to commitments.md');
}

// ============ EXTRACTION ============

/**
 * Use SCRIBE to extract commitments from a single email.
 * Returns array of commitment objects.
 */
function extractCommitmentsFromEmail_(email, classification) {
    var today = todayStr_();
    var senderEmail = extractEmailAddress(email.from || '');
    var userEmail = getConfig().USER_EMAIL;

    var promptBody = [
        'EMAIL:',
        'From: ' + email.from,
        'To: ' + (email.to || ''),
        'Subject: ' + email.subject,
        'Date: ' + (email.date ? new Date(email.date).toISOString().split('T')[0] : today),
        'Body:',
        truncate(email.body || email.snippet || '', 1200)
    ].join('\n');

    var sys = [
        'You extract commitments (promises, deadlines, action items) from email.',
        'USER EMAIL: ' + userEmail,
        'TODAY: ' + today,
        '',
        'CONFIDENCE (required per item):',
        '- "explicit": the email contains a DIRECT statement of the promise/deadline (use a verbatim quote in quote).',
        '- "inferred": Hermes deduces an obligation from tone/pattern only — NO direct promise language (quote must be null or empty).',
        '',
        'Return JSON array (empty [] if none). Each item:',
        '{',
        '  "type": "outbound" (user promised) or "inbound" (sender promised),',
        '  "description": "what was promised, specific",',
        '  "to": "email address of recipient",',
        '  "deadline": "YYYY-MM-DD or null",',
        '  "confidence": "explicit" or "inferred",',
        '  "quote": "exact phrase from email if explicit, max 80 chars; empty string if inferred"',
        '}',
        '',
        'Only extract real commitments. Ignore pleasantries like "let\'s catch up".',
        'If confidence is explicit, quote MUST be non-empty. If inferred, quote MUST be empty.',
        'If no commitments: return []'
    ].join('\n');

    try {
        var result = callAgent_(
            'entity_extraction',
            promptBody,
            sys,
            { temperature: 0.05, maxTokens: 512 }
        );
        var parsed = extractJson_(result.text);
        if (!Array.isArray(parsed)) {
            parsed = safeJsonParse(result.text);
        }
        if (!Array.isArray(parsed)) return [];

        // Enrich with metadata
        var threadId = email.threadId || '';
        return parsed.map(function (c, idx) {
            return {
                id: 'cmt_' + today.replace(/-/g, '') + '_' + String(idx + 1).padStart(3, '0') + '_' + generatedId_().substring(0, 4),
                type: c.type === 'outbound' ? 'outbound' : 'inbound',
                description: (c.description || '').trim(),
                to: c.to || (c.type === 'outbound' ? senderEmail : userEmail),
                threadId: threadId,
                subject: email.subject || '(no subject)',
                extractedDate: today,
                deadline: c.deadline || null,
                status: 'open',
                confidence: String(c.confidence || '').toLowerCase() === 'inferred' ? 'inferred' : 'explicit',
                quote: truncate(String(c.quote || '').trim(), 120)
            };
        }).map(function (c) {
            if (c.confidence === 'explicit' && (!c.quote || c.quote.length < 2)) {
                c.confidence = 'inferred';
            }
            if (c.confidence === 'inferred') {
                c.quote = '';
            }
            return c;
        }).filter(function (c) { return c.description.length > 3; });

    } catch (e) {
        Logger.log('[WARN] Commitment extraction call failed: ' + e.message);
        return [];
    }
}

// ============ MARKDOWN MERGE ============

/**
 * Merge new commitments into the existing commitments.md markdown.
 * Preserves existing entries, appends new ones under the right section.
 * Marks commitments as stale after 30 days.
 */
function mergeCommitmentsIntoMd_(existingMd, newCommitments) {
    var today = todayStr_();
    var now = new Date();
    var staleCutoff = new Date(now.getTime() - 30 * 24 * 3600000);

    // Parse existing sections
    var outbound = parseCommitmentSection_(existingMd, 'Outbound (you owe others)');
    var inbound = parseCommitmentSection_(existingMd, 'Inbound (others owe you)');
    var stale = parseCommitmentSection_(existingMd, 'Stale (30+ days, no follow-up)');

    outbound = outbound.map(function (line) {
        var first = (line || '').split('\n')[0];
        if (first.indexOf('- [ ]') === 0 && isLineStale_(line, staleCutoff)) {
            stale.push('- ~~' + first.replace(/^- \[ \] /, '') + '~~ [auto-stale]');
            return null;
        }
        return line;
    }).filter(function (l) { return l !== null; });

    inbound = inbound.map(function (line) {
        var firstIn = (line || '').split('\n')[0];
        if (firstIn.indexOf('- [ ]') === 0 && isLineStale_(line, staleCutoff)) {
            stale.push('- ~~' + firstIn.replace(/^- \[ \] /, '') + '~~ [auto-stale]');
            return null;
        }
        return line;
    }).filter(function (l) { return l !== null; });

    // De-duplicate new commitments against existing (by description similarity)
    var existingDescs = outbound.concat(inbound).map(function (l) { return l.toLowerCase(); });

    for (var i = 0; i < newCommitments.length; i++) {
        var c = newCommitments[i];
        var rendered = renderCommitmentLine_(c);

        // Simple deduplicate: skip if same description already in file
        var descLower = c.description.toLowerCase();
        var isDupe = existingDescs.some(function (e) { return e.indexOf(descLower.substring(0, 30)) !== -1; });
        if (isDupe) continue;

        if (c.type === 'outbound') {
            outbound.push(rendered);
        } else {
            inbound.push(rendered);
        }
        existingDescs.push(rendered.toLowerCase());
    }

    // Cap section sizes
    outbound = outbound.slice(-30);
    inbound = inbound.slice(-30);
    stale = stale.slice(-20);

    // Render final markdown
    var lines = [
        '# Active Commitments',
        '*Last compiled: ' + today + ' by Hermes*',
        '',
        '## Outbound (you owe others)',
        outbound.length ? outbound.join('\n') : '*(none)*',
        '',
        '## Inbound (others owe you)',
        inbound.length ? inbound.join('\n') : '*(none)*',
        '',
        '## Stale (30+ days, no follow-up)',
        stale.length ? stale.join('\n') : '*(none)*',
        '',
        '---',
        '*Hermes tracks commitments automatically. Check these weekly.*'
    ];

    return lines.join('\n');
}

/**
 * Render a single commitment as a markdown checklist line + optional one-line quote.
 */
function renderCommitmentLine_(c) {
    var parts = [c.description];

    if (c.to && c.to !== getConfig().USER_EMAIL) {
        parts.push('\u2192 ' + c.to);
    }
    if (c.deadline) {
        parts.push('due ' + c.deadline);
    }
    parts.push('[' + c.confidence + ']');
    var url = gmailThreadUrl_(c.threadId || '');
    if (url) {
        parts.push('[source](' + url + ')');
    }

    var main = '- [ ] ' + parts.join(' \u2014 ');
    var qline = formatCommitmentQuoteLine_(c.quote);
    return qline ? main + '\n' + qline : main;
}

/**
 * Parse a section of the commitments markdown file.
 * Returns array of bullet lines.
 */
function parseCommitmentSection_(md, sectionHeading) {
    if (!md) return [];
    var start = md.indexOf('## ' + sectionHeading);
    if (start === -1) return [];
    var after = md.substring(start + sectionHeading.length + 3);
    var end = after.indexOf('\n## ');
    var section = end > 0 ? after.substring(0, end) : after;
    var lines = section.split('\n');
    var blocks = [];
    var cur = null;
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (/^- \[ \]/.test(line)) {
            if (cur) blocks.push(cur);
            cur = line;
        } else if (cur && /^\s+>/.test(line)) {
            cur += '\n' + line;
        } else if (cur && line.trim() === '') {
            continue;
        }
    }
    if (cur) blocks.push(cur);
    return blocks.filter(function (b) { return b.trim().length > 3; });
}

/**
 * Detect if a commitment line is stale based on any date mentioned in the text.
 * Conservative: only marks stale if we can find a date older than cutoff.
 */
function isLineStale_(line, cutoff) {
    var text = (line || '').split('\n')[0];
    var m = text.match(/(\d{4}-\d{2}-\d{2})/);
    if (!m) return false;
    return new Date(m[1]) < cutoff;
}

// ============ WIKI INDEX ============

/**
 * Maintain wiki/index.md — a table of contents for all wiki files.
 */
function updateWikiIndex_() {
    try {
        var wikiFolder = getWikiFolder_();
        if (!wikiFolder) return;

        var lines = [
            '# Hermes Wiki Index',
            '*Auto-updated: ' + todayStr_() + '*',
            '',
            '## People',
            ''
        ];

        // List people files
        var peopleFolder = null;
        var pf = wikiFolder.getFoldersByName('people');
        if (pf.hasNext()) {
            peopleFolder = pf.next();
            var peopleFiles = peopleFolder.getFiles();
            while (peopleFiles.hasNext()) {
                var f = peopleFiles.next();
                var fname = f.getName();
                lines.push('- [[people/' + fname + ']] — updated ' + f.getLastUpdated().toISOString().split('T')[0]);
            }
        }

        lines.push('');
        lines.push('## Commitments');
        lines.push('- [[commitments.md]]');
        lines.push('');
        lines.push('---');
        lines.push('*Hermes compiles this wiki automatically from your email.*');

        writeWikiFile_('index.md', lines.join('\n'));
    } catch (e) {
        Logger.log('[WARN] updateWikiIndex_ failed: ' + e.message);
    }
}
