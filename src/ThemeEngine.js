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

  default: {
    name: 'default',
    bg: '#f5f5f5', cardBg: '#ffffff', headerBg: '#e8e8e8',
    text: '#333333', textBright: '#000000', textMuted: '#888888', textDim: '#bbbbbb',
    accent: '#0066cc', accent2: '#00aa44', accent3: '#cc4400', success: '#228822',
    border: '#dddddd', radius: '8px',
    font: 'Arial, Helvetica, sans-serif',
    style: 'clean minimal professional default',
    vibe: 'standard corporate'
  }
};

// = THEME ACCESSORS ============

function getTheme() {
  const prefs = getPreferences_();
  const themeName = prefs.theme && prefs.theme.name 
    ? prefs.theme.name 
    : getProp('ACTIVE_THEME') 
    || 'midnight';
  
  if (BUILT_IN_THEMES[themeName]) {
    return BUILT_IN_THEMES[themeName];
  }
  
  // Custom theme support
  if (typeof themeName === 'string' && !BUILT_IN_THEMES[themeName]) {
    return { ...BUILT_IN_THEMES.default, name: themeName };
  }
  
  return BUILT_IN_THEMES.midnight;
}

function setTheme(themeOrName) {
  if (!themeOrName) return;
  
  if (typeof themeOrName === 'object') {
    setProp('ACTIVE_THEME', JSON.stringify(themeOrName));
  } else {
    setProp('ACTIVE_THEME', themeOrName);
  }
}

// = THEME PROMPT CONTEXT ============

function getThemePromptContext() {
  const t = getTheme();
  
  return `
═══ VISUAL DESIGN SYSTEM ═══
Current theme: ${t.name}

STYLE DIRECTION: ${t.style}

COLOR PALETTE (use these EXACT hex values in inline styles):
Page background: ${t.bg}
Card/section bg: ${t.cardBg}
Header bg: ${t.headerBg}
Body text: ${t.text}
Headings/emphasis: ${t.textBright}
Secondary/timestamps: ${t.textMuted}
Dim/timestamps: ${t.textDim}
Primary accent: ${t.accent} (alerts, CTAs, important)
Secondary accent: ${t.accent2} (info, links, deadlines)
Tertiary accent: ${t.accent3} (warnings, highlights)
Success/positive: ${t.success}
Borders/dividers: ${t.border}

TYPOGRAPHY:
Body font: ${t.font}
Code font: ${t.mono}
Border radius: ${t.radius}
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
  const now = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const safeTitle = sanitizeEmailHtml_(title) || '';
  
  return wrapEmail_(`
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${t.cardBg};border-radius:${t.radius};overflow:hidden;border:1px solid ${t.border};margin-top:16px;">
<tr><td style="padding:14px 20px;background:${t.headerBg};border-bottom:1px solid ${t.border};font-family:${t.font};font-weight:700;font-size:14px;color:${t.textBright};">${safeTitle}</td></tr>
<tr><td style="padding:20px;font-family:${t.font};font-size:14px;line-height:1.8;color:${t.text};">${bodyHtml}</td></tr>
</table>
`);
}