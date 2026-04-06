/**
 * HERMES — SchemaLoader.gs
 * Loads and parses repo-style schema.md from Drive (human-edited operating preferences).
 */

/**
 * Read full schema.md text from VAULT (FILE_SCHEMA_MD) or script property SCHEMA_FILE_ID.
 * @returns {string}
 */
function readSchemaMd_() {
  try {
    var raw = readMemory('FILE_SCHEMA_MD');
    if (raw && String(raw).trim().length > 0) return String(raw);
  } catch (e) {
    Logger.log('[WARN] readSchemaMd_ readMemory: ' + e.message);
  }
  var altId = getProp('SCHEMA_FILE_ID');
  if (altId) {
    try {
      return DriveApp.getFileById(altId).getBlob().getDataAsString();
    } catch (e2) {
      Logger.log('[WARN] readSchemaMd_ SCHEMA_FILE_ID: ' + e2.message);
    }
  }
  return '';
}

/**
 * Extract section body after ## Heading until next ## or EOF.
 * @param {string} md
 * @param {string} headingTitle e.g. "Priority Contacts"
 * @returns {string}
 */
function extractSchemaSection_(md, headingTitle) {
  if (!md) return '';
  var needle = '## ' + headingTitle;
  var start = md.indexOf(needle);
  if (start === -1) return '';
  var after = md.substring(start + needle.length);
  var next = after.search(/\n## /);
  var body = next >= 0 ? after.substring(0, next) : after;
  return body.trim();
}

/**
 * Pull bullet lines: - item or * item
 * @param {string} sectionBody
 * @returns {string[]}
 */
function extractSchemaBullets_(sectionBody) {
  if (!sectionBody) return [];
  var lines = sectionBody.split('\n');
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    var m = line.match(/^[-*]\s+(.+)$/);
    if (m) out.push(m[1].trim());
  }
  return out;
}

/**
 * First email-like token in a bullet (handles [x@y.com] — context).
 * @param {string} bullet
 * @returns {string|null}
 */
function extractEmailFromBullet_(bullet) {
  if (!bullet) return null;
  var br = bullet.match(/\[([^\]]+@[^\]]+)\]/);
  if (br) return br[1].toLowerCase().trim();
  var em = bullet.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  if (em) return em[1].toLowerCase().trim();
  return null;
}

/**
 * Parse schema.md into structured prefs for runtime.
 * @param {string} md
 * @returns {{ raw: string, priorityContacts: string[], mutedSenders: string[], communicationStyle: string }}
 */
function parseHermesSchemaMd_(md) {
  var text = md || '';
  var prioritySection = extractSchemaSection_(text, 'Priority Contacts');
  var mutedSection = extractSchemaSection_(text, 'Muted Senders');
  var commSection = extractSchemaSection_(text, 'Communication Style');

  var priorityBullets = extractSchemaBullets_(prioritySection);
  var priorityContacts = [];
  for (var i = 0; i < priorityBullets.length; i++) {
    var em = extractEmailFromBullet_(priorityBullets[i]);
    if (em) priorityContacts.push(em);
  }

  var mutedBullets = extractSchemaBullets_(mutedSection);
  var mutedSenders = [];
  for (var j = 0; j < mutedBullets.length; j++) {
    var b = mutedBullets[j].replace(/^\*\*|\*\*$/g, '').trim();
    if (b) mutedSenders.push(b);
  }

  var commLines = commSection ? commSection.split('\n').map(function (l) { return l.trim(); }).filter(Boolean) : [];
  var communicationStyle = commLines.join('\n');

  return {
    raw: text,
    priorityContacts: priorityContacts,
    mutedSenders: mutedSenders,
    communicationStyle: communicationStyle || ''
  };
}

/**
 * Load parsed schema (empty object fields if missing file).
 */
function getParsedSchema_() {
  var md = readSchemaMd_();
  return parseHermesSchemaMd_(md);
}

/**
 * True if sender matches a muted pattern (same semantics as matchesAutoPattern_).
 * @param {{from:string}} email
 * @param {string[]} mutedPatterns
 */
function isMutedSender_(email, mutedPatterns) {
  return matchesAutoPattern_(email, mutedPatterns || []);
}

/**
 * Boost classification for priority contacts (post-model, deterministic).
 * @param {{from:string}} email
 * @param {Object} classification mutable
 * @param {string[]} priorityEmails lowercased emails
 */
function applyPriorityContactBoost_(email, classification, priorityEmails) {
  if (!priorityEmails || !priorityEmails.length || !classification) return;
  var from = extractEmailAddress(email.from || '').toLowerCase();
  for (var i = 0; i < priorityEmails.length; i++) {
    var p = (priorityEmails[i] || '').toLowerCase().trim();
    if (!p) continue;
    if (p.endsWith('*')) {
      if (from.startsWith(p.slice(0, -1))) {
        bumpPriorityClassification_(classification);
        return;
      }
    } else if (from === p || from.indexOf(p) !== -1) {
      bumpPriorityClassification_(classification);
      return;
    }
  }
}

function bumpPriorityClassification_(c) {
  c.importance = Math.max(Number(c.importance) || 5, 10);
  c.urgency_score = Math.max(Number(c.urgency_score) || 5, 8);
  if (!c.summary || c.summary.indexOf('(priority contact)') === -1) {
    c.summary = '(priority contact) ' + (c.summary || '');
  }
}
