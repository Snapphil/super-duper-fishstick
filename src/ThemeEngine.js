/**
 * HERMES — ThemeEngine.gs
 * ============================================
 * PANTHEON SYSTEM: AESTHETE (Visual Design Engine)
 * 
 * Manages themes, generates visual components, ensures email-safe output.
 */

// ============ BUILT-IN THEMES ============

const BUILT_IN_THEMES = {
  midnight: {
    name: 'midnight',
    bg: '#0a0a0a', cardBg: '#111111', headerBg: '#080808',
    text: '#aaaaaa', textBright: '#ffffff', textMuted: '#555555', textDim: '#333333',
    accent: '#e44444', accent2: '#8b5cf6', accent3: '#f59e0b', success: '#22c55e',
    border: '#1e1e1e', radius: '8px',
    font: 'Arial, Helvetica, sans-serif',
    mono: '"Courier New", Courier, monospace',
    style: 'dark, minimal, sharp, monochrome with red accents',
    vibe: 'midnight control room'
  },
  
  ocean: {
    name: 'ocean',
    bg: '#0c1628', cardBg: '#132338', headerBg: '#081020',
    text: '#a8c5dd', textBright: '#e0f0ff', textMuted: '#5a7a94', textDim: '#3a5068',
    accent: '#38bdf8', accent2: '#818cf8', accent3: '#34d399', success: '#22d3ee',
    border: '#1e3a5f', radius: '12px',
    font: 'Helvetica, Arial, sans-serif',
    style: 'deep ocean calm spacious blue gradient',
    vibe: 'submarine dashboard'
  },
  
  brutalist: {
    name: 'brutalist',
    bg: '#ffffff', cardBg: '#000000', headerBg: '#000000',
    text: '#000000', textBright: '#000000', textMuted: '#666666', textDim: '#999999',
    accent: '#ff0000', accent2: '#ffff00', accent3: '#00ff00', success: '#00ff00',
    border: '#000000', radius: '0px',
    font: '"Arial Black", Impact, sans-serif',
    style: 'neo-brutalist thick borders stark raw uppercase',
    vibe: 'design manifesto poster'
  },
  
  warm: {
    name: 'warm',
    bg: '#faf6f1', cardBg: '#ffffff', headerBg: '#f5ebe0',
    text: '#4a3728', textBright: '#2d1f14', textMuted: '#8b7355', textDim: '#c4b5a0',
    accent: '#e07b39', accent2: '#c45b28', accent3: '#5b8c5a', success: '#6ba368',
    border: '#e8dfd3', radius: '16px',
    font: 'Georgia, "Times New Roman", serif',
    style: 'warm elegant serif cream letter on paper',
    vibe: 'cozy study'
  },
  
  neon: {
    name: 'neon',
    bg: '#0a001a', cardBg: '#150029', headerBg: '#0d001a',
    text: '#e0d0ff', textBright: '#ffffff', textMuted: '#8060a0', textDim: '#402060',
    accent: '#ff00ff', accent2: '#00ffff', accent3: '#ffff00', success: '#00ff88',
    border: '#301050', radius: '4px',
    font: '"Courier New", monospace',
    style: 'cyberpunk neon retro-futuristic purple pink cyan',
    vibe: 'terminal hacker'
  },
  
  vapor: {
    name: 'vapor',
    bg: '#a18cd1', cardBg: 'rgba(255,255,255,0.15)', headerBg: '#84fab0',
    text: '#ffffff', textBright: '#ffffff', textMuted: 'rgba(255,255,255,0.7)', textDim: 'rgba(255,255,255,0.4)',
    accent: '#fccb90', accent2: '#ee9ca7', accent3: '#a18cd1', success: '#84fab0',
    border: 'rgba(255,255,255,0.2)', radius: '20px',
    font: '"Arial Rounded MT Bold", Arial, sans-serif',
    style: 'vaporwave retro gradient purple-pink miami sunset',
    vibe: '80s Miami sunset'
  },

  military: {
    name: 'military',
    bg: '#1a1a0e', cardBg: '#252510', headerBg: '#0f0f08',
    text: '#a8a870', textBright: '#d4d49a', textMuted: '#5a5a30', textDim: '#3a3a20',
    accent: '#8aaa40', accent2: '#c8a020', accent3: '#e05020', success: '#60a030',
    border: '#3a3a20', radius: '2px',
    font: '"Courier New", Courier, monospace',
    mono: '"Courier New", Courier, monospace',
    style: 'military tactical olive drab khaki combat operations',
    vibe: 'field operations command post'
  },

  default: {
    name: 'default',
    bg: '#f2f2f7', cardBg: '#ffffff', headerBg: '#f2f2f7',
    text: '#1c1c1e', textBright: '#000000', textMuted: '#6e6e73', textDim: '#aeaeb2',
    accent: '#007aff', accent2: '#34c759', accent3: '#ff9500', success: '#34c759',
    border: '#c6c6c8', radius: '12px',
    font: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif',
    mono: '"SF Mono", "Courier New", Courier, monospace',
    style: 'iOS high-contrast clean minimal system UI',
    vibe: 'iOS settings panel'
  }
};

// = THEME ACCESSORS ============

function getTheme() {
  const prefs = getPreferences_();

  // prefs.theme can be a full object if set by handleDesignChange_
  if (prefs.theme && typeof prefs.theme === 'object' && prefs.theme.bg) {
    return prefs.theme;
  }

  const stored = (prefs.theme && prefs.theme.name)
    ? prefs.theme.name
    : getProp('ACTIVE_THEME') || 'midnight';

  // ACTIVE_THEME may be a JSON-serialized theme object (set via setTheme(object))
  if (typeof stored === 'string' && stored.charAt(0) === '{') {
    try {
      const obj = JSON.parse(stored);
      if (obj && obj.name && obj.bg) return obj;
    } catch (e) { /* fall through */ }
  }

  const themeName = typeof stored === 'string' ? stored.toLowerCase() : 'midnight';

  if (BUILT_IN_THEMES[themeName]) {
    return BUILT_IN_THEMES[themeName];
  }

  // Unknown theme name — return default palette but preserve the name
  return Object.assign({}, BUILT_IN_THEMES.default, { name: themeName });
}

function setTheme(themeOrName) {
  if (!themeOrName) return;

  if (typeof themeOrName === 'object') {
    // Store full theme object as JSON so getTheme() can restore it
    setProp('ACTIVE_THEME', JSON.stringify(themeOrName));
  } else {
    // Normalise to lowercase so BUILT_IN_THEMES lookup is case-insensitive
    setProp('ACTIVE_THEME', String(themeOrName).toLowerCase().trim());
  }
}

// = THEME PROMPT CONTEXT ============

/**
 * Full visual design context for ORACLE — includes theme, UI prefs/feedback, and email-safe rendering rules.
 * Inject this into ANY prompt that generates HTML email content.
 */
function getThemePromptContext() {
  const t = getTheme();
  const uiCtx = getUiPrefsContext_();

  return `
═══ VISUAL DESIGN SYSTEM ═══
Current theme: ${t.name} — ${t.vibe}
Style direction: ${t.style}

COLOR PALETTE (use these EXACT hex values in inline styles — no CSS classes):
  bg: ${t.bg}  |  cardBg: ${t.cardBg}  |  headerBg: ${t.headerBg}
  text: ${t.text}  |  textBright: ${t.textBright}  |  textMuted: ${t.textMuted}  |  textDim: ${t.textDim}
  accent: ${t.accent} (primary CTA/alert)
  accent2: ${t.accent2} (info/deadlines/links)
  accent3: ${t.accent3} (warnings/highlights)
  success: ${t.success}  |  border: ${t.border}

TYPOGRAPHY: body=${t.font} | mono=${t.mono} | radius=${t.radius}

EMAIL RENDERING RULES (non-negotiable):
- Table-based layout only — no flex, no grid, no CSS grid
- All styles MUST be inline (no <style> blocks, no classes)
- No JavaScript, no external images without fallback
- SVG charts/icons are allowed (Gmail, Apple Mail, Outlook.com support them)
- Table-based progress bars/charts are most compatible fallback
- Font size: body 14px, captions 11px, headings 18-22px max
- Max email width: 600px
- Avoid background-image on critical content (Outlook strips it)

VISUAL COMPONENTS AVAILABLE (use these patterns):
  Progress bar: <table width="100%" style="background:${t.border};border-radius:4px;height:8px;"><tr><td width="75%" style="background:${t.accent};height:8px;border-radius:4px;"></td><td></td></tr></table>
  Badge: <span style="display:inline-block;padding:2px 10px;background:${t.accent};color:#fff;border-radius:20px;font-size:11px;font-weight:700;">LABEL</span>
  Divider: <table width="100%" style="margin:12px 0;"><tr><td style="border-top:1px solid ${t.border};"></td></tr></table>
  Code block: <div style="background:${t.headerBg};padding:12px;border-left:3px solid ${t.accent};font-family:${t.mono};font-size:12px;color:${t.text};">...</div>

═══ USER UI PREFERENCES (AESTHETE MEMORY) ═══
${uiCtx}
`.trim();
}

// = EMAIL WRAPPER ============

/**
 * Wrap inner HTML in standard HERMES container.
 * Adds agent marker and outer structure.
 */
function wrapEmail_(innerHtml) {
  const cfg = getConfig();
  const t = getTheme();
  
  return `<div style="margin:0;padding:0;background:${t.bg};font-family:${t.font};">
<!--hermes-agent-->
<table align="center" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;margin:0 auto;">
<tr><td>
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${t.cardBg};border:1px solid ${t.border};border-radius:${t.radius};">
<tr><td style="padding:14px 20px;font-size:11px;font-weight:700;letter-spacing:0.15em;color:${t.textMuted};text-transform:uppercase;font-family:${t.font};">${cfg.NAME}</td></tr>
<tr><td align="right" style="padding:14px 20px;font-size:10px;color:${t.textDim};font-family:${t.font};">${formatDateShort(new Date())}&nbsp;&middot;&nbsp;${new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</td></tr>
</table>
</td></tr>
</table>
 ${innerHtml}
</div>`;
}

/**
 * Quick themed card for simple messages (errors, confirmations).
 * Does NOT call Gemini - instant rendering.
 */
function quickCard_(title, bodyHtml) {
  const t = getTheme();
  const safeTitle = sanitizeEmailHtml_(title) || '';

  return wrapEmail_(`
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${t.cardBg};border-radius:${t.radius};overflow:hidden;border:1px solid ${t.border};margin-top:16px;">
<tr><td style="padding:14px 20px;background:${t.headerBg};border-bottom:1px solid ${t.border};font-family:${t.font};font-weight:700;font-size:14px;color:${t.textBright};">${safeTitle}</td></tr>
<tr><td style="padding:20px;font-family:${t.font};font-size:14px;line-height:1.8;color:${t.text};">${bodyHtml}</td></tr>
</table>
`);
}

// = EMAIL-SAFE VISUAL COMPONENTS ============

/**
 * Render an email-safe horizontal progress bar.
 * @param {number} value  Current value (0–max).
 * @param {number} max    Maximum value (default 100).
 * @param {string} label  Optional label shown to the right.
 * @param {string} color  Optional override hex color (uses theme accent by default).
 * @returns {string} HTML snippet — inline safe, no JS.
 */
function buildProgressBar_(value, max, label, color) {
  const t = getTheme();
  max = max || 100;
  const pct = Math.min(100, Math.max(0, Math.round((value / max) * 100)));
  const barColor = color || t.accent;
  const labelHtml = label
    ? '<td style="padding-left:10px;font-family:' + t.font + ';font-size:12px;color:' + t.textMuted + ';white-space:nowrap;">' + escapeHtml(String(label)) + '</td>'
    : '';
  return '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0;">' +
    '<tr>' +
      '<td>' +
        '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + t.border + ';border-radius:4px;height:8px;">' +
          '<tr>' +
            (pct > 0 ? '<td width="' + pct + '%" style="background:' + barColor + ';height:8px;border-radius:4px 0 0 4px;"></td>' : '') +
            (pct < 100 ? '<td style="height:8px;"></td>' : '') +
          '</tr>' +
        '</table>' +
      '</td>' +
      labelHtml +
    '</tr>' +
  '</table>';
}

/**
 * Render an email-safe vertical bar chart using tables.
 * @param {Array<{label:string, value:number, color?:string}>} data  Chart rows.
 * @param {string} title  Optional chart title.
 * @returns {string} HTML table — inline safe.
 */
function buildBarChart_(data, title) {
  const t = getTheme();
  if (!data || !data.length) return '';
  const max = data.reduce(function(m, d) { return Math.max(m, d.value || 0); }, 0) || 1;

  var titleHtml = title
    ? '<tr><td colspan="3" style="padding:0 0 10px 0;font-family:' + t.font + ';font-size:13px;font-weight:700;color:' + t.textBright + ';">' + escapeHtml(title) + '</td></tr>'
    : '';

  var rows = data.map(function(d) {
    var pct = Math.round(((d.value || 0) / max) * 100);
    var barColor = d.color || t.accent;
    return '<tr>' +
      '<td style="padding:4px 10px 4px 0;font-family:' + t.font + ';font-size:12px;color:' + t.textMuted + ';white-space:nowrap;min-width:80px;">' + escapeHtml(String(d.label)) + '</td>' +
      '<td style="padding:4px 8px 4px 0;" width="100%">' +
        '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + t.border + ';border-radius:3px;height:14px;">' +
          '<tr>' +
            (pct > 0 ? '<td width="' + pct + '%" style="background:' + barColor + ';height:14px;border-radius:3px 0 0 3px;"></td>' : '') +
            (pct < 100 ? '<td style="height:14px;"></td>' : '') +
          '</tr>' +
        '</table>' +
      '</td>' +
      '<td style="padding:4px 0;font-family:' + t.font + ';font-size:12px;color:' + t.text + ';white-space:nowrap;">' + escapeHtml(String(d.value)) + '</td>' +
    '</tr>';
  }).join('');

  return '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;">' +
    titleHtml + rows +
  '</table>';
}

/**
 * Render a colored inline badge/pill.
 * @param {string} text    Badge label.
 * @param {string} color   Background hex (default: theme accent).
 * @param {string} textColor Text hex (default: #ffffff).
 */
function buildBadge_(text, color, textColor) {
  const t = getTheme();
  const bg = color || t.accent;
  const fg = textColor || '#ffffff';
  return '<span style="display:inline-block;padding:2px 10px;background:' + bg + ';color:' + fg + ';border-radius:20px;font-size:11px;font-weight:700;font-family:' + t.font + ';">' + escapeHtml(String(text)) + '</span>';
}

/**
 * Render a section divider with optional label.
 * @param {string} label  Optional section label.
 */
function buildDivider_(label) {
  const t = getTheme();
  if (label) {
    return '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 10px 0;">' +
      '<tr>' +
        '<td style="border-top:1px solid ' + t.border + ';"></td>' +
        '<td style="padding:0 12px;white-space:nowrap;font-family:' + t.font + ';font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:' + t.textDim + ';">' + escapeHtml(label) + '</td>' +
        '<td style="border-top:1px solid ' + t.border + ';"></td>' +
      '</tr>' +
    '</table>';
  }
  return '<table width="100%" style="margin:14px 0;"><tr><td style="border-top:1px solid ' + t.border + ';"></td></tr></table>';
}