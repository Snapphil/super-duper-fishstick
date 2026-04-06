/**
 * HERMES — Cipher.gs (formerly Utils.gs)
 * ============================================
 * PANTHEON SYSTEM: Security, Sanitization & Utility Functions
 * 
 * CONSOLIDATED: Removed 3 duplicate copies. Single source of truth.
 */

// ============ STRING UTILITIES ============

function truncate(str, maxLen) {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 3) + '...';
}

function safeJsonParse(str) {
  try { return JSON.parse(str); }
  catch (e) { return null; }
}

function generatedId_() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 10; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

// ============ DATE FORMATTING ============

function formatDateFull(date) {
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let h = date.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const m = date.getMinutes().toString().padStart(2,'0');
  return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}, ${h}:${m} ${ampm}`;
}

function formatDateShort(date) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}

function todayStr_() {
  return new Date().toISOString().split('T')[0];
}

// ============ HTML SANITIZATION (FIXED) ============

/**
 * Sanitize HTML for Gmail compatibility.
 * FIXED: Less aggressive, preserves structure better.
 */
function sanitizeEmailHtml_(html) {
  if (!html) return '';
  
  // 1. Replace Unicode emoji with safe alternatives (comprehensive map)
  const emojiMap = {
    // Emoticons
    '😀':'😁','😂':'🤣','😊':'☺️','❤️':'♥️','👍':'👍',
    '✅':'✔️','⚠️':'⚠️','💡':'💡','🔥':'🔥','⭐':'⭐',
    // Symbols
    '→':'→','←':'←','↑':'↑','↓':'↓','•':'•',
    // Misc Unicode ranges that break Gmail
    '\u{1F600}':'[:smile:]','\u{1F604}':'[:laugh]',
    '\u{1F44D}':'[:thumbup:]','\u{2705}':'[:check:]',
    '\u{26A0}':'[:warning:]','\u{1F4A1}':'[:bulb:]',
    '\u{2B50}':'[:star:]','\u{1F525}':'[:fire:]',
    '\u{2728}':'[:sparkles:]','\u{1F4DD}':'[:memo:]',
    '\u{1F4C4}':'[:file:]','\u{1F4E5}':'[:inbox:]',
    '\u{1F30D}':'[:globe:]','\u{1F3AF}':'[:target:]',
    '\u{1F680}':'[:rocket:]','\u{2699}':'[:gear:]',
    '\u{1F50D}':'[:search:]','\u{1F4CA}':'[:chart:]',
    '\u{1F4CB}':'[:clipboard:]','\u{270F}':'[:pencil:]',
    '\u{1F3AF}':'[:dart:]','\u{1F3AD}':'[:stage:]',
    '\u{1F4A1}':'[:bulb:]','\u{1F6E0}':'[:construction:]',
    '\u{2696}':'[:balance:]','\u{1F91D}':'[:handshake:]',
    '\u{1F4BC}':'[:briefcase:]','\u{1F4B0}':'[:money:]',
    '\u{2601}':'[:cloud:]','\u{26C4}':'[:snowman:]',
    '\u{1F300}':'[:cyclone:]','\u{1F3D4}':'[:snowflake:]'
  };
  
  for (const [unicode, replacement] of Object.entries(emojiMap)) {
    html = html.split(unicode).join(replacement);
  }
  
  // 2. Strip style blocks (Gmail removes them anyway, causes issues)
  html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  
  // 3. Strip script blocks (security)
  html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  
  // 4. Close unclosed common tags (conservative approach)
  const tagPairs = [
    [/\<div([^>]*)>/gi, '</div>'],
    [/\<td([^>]*)>/gi, '</td>'],
    [/\<tr([^>]*)>/gi, '</tr>'],
    [/\<span([^>]*)>/gi, '</span>'],
    [/\<b([^>]*)>/gi, '</b>'],
    [/\<strong([^>]*)>/gi, '</strong>'],
    [/\<i([^>]*)>/gi, '</i>'],
    [/\<em([^>]*)>/gi, '</em>']
  ];
  
  for (const [openPattern, closeTag] of tagPairs) {
    const opens = (html.match(openPattern) || []).length;
    const closes = (html.split(closeTag).length - 1);
    const missing = opens - closes;
    if (missing > 0) {
      html += closeTag.repeat(missing);
    }
  }
  
  // 5. Remove MSO conditionals (Outlook artifacts)
  html = html.replace(/<!--\[if[^\]]*\]>[\s\S]*?<!\[endif\]-->/gi, '');
  
  // 6. Final sanity check
  if (html.trim().length < 20) {
    return '<div style="padding:20px;color:#666;font-family:sans-serif;">Content generation failed. Try <code>brief me</code> instead.</div>';
  }
  
  return html;
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function stripHtml(html) {
  return (html || '')
    .replace(/<(?!\/?(br|p)\b)[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ============ EMAIL EXTRACTION ============

function extractReplyText(rawBody) {
  if (!rawBody) return '';
  const separators = [
    /\On.+wrote:\$/mi,
    /\-{3}.+Original Message.+\-{3}$/mis,
    /^From:.+$/m,
    /^>+.+Sent:.+$/m,
    /^>.+/m
  ];
  
  let text = rawBody;
  for (const sep of separators) {
    const match = text.search(sep);
    if (match > 0) {
      text = text.substring(0, match);
      break;
    }
  }
  return text.trim();
}

function extractEmailAddress(from) {
  if (!from) return '';
  const match = from.match(/<([^>]+)>/);
  return match ? match[1].toLowerCase().trim() : from.toLowerCase().trim();
}

// ============ QUICK COMMAND PARSER ============

function quickParseCommand(text) {
  const t = (text || '').trim().toLowerCase();
  
  // Approval shortcuts
  const approveMatch = t.match(/#?(\d+)\s*(yes|approve|send|ok|confirmed)/i);
  if (approveMatch) {
    return { intent: 'approve', shortcode: approveMatch[1] };
  }
  
  // Reject shortcut
  const rejectMatch = t.match(/#?(\d+)\s*(skip|no|reject|cancel|discard)/i);
  if (rejectMatch) {
    return { intent: 'reject', shortcode: rejectMatch[1] };
  }
  
  // Bulk approve
  if (/^all\s*(yes|approve|send)/i.test(t)) {
    return { intent: 'approve_all' };
  }
  
  // Brief me
  if (/(brief\s*me|briefing|summary|summarize)/i.test(t) && /(what'?s\s*up|what\s*did\s*i\s*miss)/i.test(t)) {
    return { intent: 'brief_me' };
  }
  
  // Status
  if (/^status$/i.test(t)) {
    return { intent: 'status' };
  }
  
  // Pause
  const pauseMatch = t.match(/pause(?:\s+(?:for\s+)?)?(\d+)\s*(h|hr|hours?|d|days?)?/i);
  if (pauseMatch) {
    let hours = Number(pauseMatch[1]) || 24;
    const unit = pauseMatch[2] || '';
    if (/^d/i.test(unit)) hours *= 24;
    return { intent: 'pause', hours };
  }
  
  // Resume
  if (/^resume$/i.test(t)) {
    return { intent: 'resume' };
  }
  
  // Show deadlines
  if (/(show\s+)?deadlines/i.test(t)) {
    return { intent: 'show_deadlines' };
  }
  
  return null;
}