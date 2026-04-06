/**
 * HERMES — RawCapture.gs
 * Karpathy Layer 1 — append-only raw email snapshots under raw/{YYYY-MM-DD}/.
 * Never update or delete files in raw/.
 */

/**
 * Ensure raw root folder exists; set RAW_FOLDER_ID.
 */
function setupRawVault_() {
  try {
    var cfg = getConfig();
    var root = cfg.ROOT_FOLDER_ID
      ? DriveApp.getFolderById(cfg.ROOT_FOLDER_ID)
      : DriveApp.getRootFolder();
    var raw = mkdirp_('raw', root);
    setProp('RAW_FOLDER_ID', raw.getId());
    return raw;
  } catch (e) {
    Logger.log('[WARN] setupRawVault_: ' + e.message);
    return null;
  }
}

function getRawFolder_() {
  var id = getProp('RAW_FOLDER_ID');
  if (id) {
    try {
      return DriveApp.getFolderById(id);
    } catch (e) { }
  }
  var cfg = getConfig();
  var root = cfg.ROOT_FOLDER_ID
    ? DriveApp.getFolderById(cfg.ROOT_FOLDER_ID)
    : DriveApp.getRootFolder();
  var sub = root.getFoldersByName('raw');
  if (sub.hasNext()) {
    var f = sub.next();
    setProp('RAW_FOLDER_ID', f.getId());
    return f;
  }
  return setupRawVault_();
}

/**
 * Slugify email subject for filename (safe, bounded).
 */
function subjectSlugForRaw_(subject) {
  var s = (subject || 'no-subject').toLowerCase();
  s = s.replace(/^re:\s*/i, '').replace(/^fwd:\s*/i, '').trim();
  s = s.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!s) s = 'email';
  if (s.length > 60) s = s.substring(0, 60).replace(/-$/, '');
  return s;
}

/**
 * Gmail label names for thread (comma-separated).
 */
function getThreadLabelNames_(thread) {
  if (!thread || typeof thread.getLabels !== 'function') return '';
  try {
    var labels = thread.getLabels();
    return labels.map(function (l) { return l.getName(); }).join(', ');
  } catch (e) {
    return '';
  }
}

/**
 * Append-only: create one new file per email. Filename includes threadId for uniqueness.
 * @param {Array} emails from fetchUnprocessedEmails_
 */
function captureRawEmails_(emails) {
  if (!emails || emails.length === 0) return;
  var rawRoot = getRawFolder_();
  if (!rawRoot) {
    Logger.log('[WARN] captureRawEmails_: no raw folder');
    return;
  }

  var dateStr = todayStr_();
  var dayFolder = mkdirp_(dateStr, rawRoot);

  for (var i = 0; i < emails.length; i++) {
    var email = emails[i];
    try {
      var threadId = email.threadId || '';
      if (!threadId) continue;

      var slug = subjectSlugForRaw_(email.subject);
      var fname = slug + '-' + threadId + '.md';

      var existing = dayFolder.getFilesByName(fname);
      if (existing.hasNext()) {
        continue;
      }

      var labels = getThreadLabelNames_(email.thread);
      var dateLine = email.date ? new Date(email.date).toISOString().split('T')[0] : todayStr_();

      var body = (email.body || email.snippet || '').replace(/\r\n/g, '\n');

      var md = [
        '# ' + (email.subject || '(no subject)').replace(/\n/g, ' '),
        '**From:** ' + (extractEmailAddress(email.from) || email.from || ''),
        '**Date:** ' + dateLine,
        '**Thread ID:** ' + threadId,
        '**Labels:** ' + (labels || '(none)'),
        '',
        '---',
        '',
        body
      ].join('\n');

      dayFolder.createFile(fname, md, MimeType.PLAIN_TEXT);
    } catch (e) {
      Logger.log('[WARN] captureRawEmails_ skip: ' + e.message);
    }
  }
}
