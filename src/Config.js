/**
 * HERMES — Config.gs
 * ============================================
 * PANTHEON SYSTEM: Core Configuration & Constants
 * 
 * AGENTS:
 * - ORACLE: Gemini Pro (Deep reasoning, generation)
 * - SCRIBE: Gemini Flash (Fast classification, parsing)
 * 
 * STORAGE: VAULT (Google Drive JSON files)
 * COMM: RELAY (Gmail API wrapper)
 */

// ============ AGENT DEFINITIONS ============



const AGENTS = {
  ORACLE: {
    id: 'oracle',
    model:'gemini-3.1-pro-preview',  // Primary reasoning engine
    temperature: 0.7,        // Creative but grounded
    maxTokens: 4096,         // Full email generation budget
    role: 'deep_reasoning',
    capabilities: [
      'email_generation',
      'research_synthesis',
      'conversational_reply',
      'draft_editing',
      'visual_design'
    ],
    costTier: 'high'  // Use sparingly
  },
  
  SCRIBE: {
    id: 'scribe',
    model: 'gemini-3-flash-preview',  // Fast classification engine
    temperature: 0.1,        // Deterministic, consistent
    maxTokens: 1024,          // Lightweight tasks only
    role: 'fast_classification',
    capabilities: [
      'email_classification',
      'command_parsing',
      'entity_extraction',
      'urgency_scoring',
      'quick_lookup'
    ],
    costTier: 'low'   // Use freely
  }
};

// ============ VAULT STRUCTURE (File IDs) ============

const VAULT = {
  // Core identity files
  AGENT_MD: 'FILE_AGENT_MD',           // Agent personality config
  PREFERENCES: 'FILE_PREFERENCES',     // User preferences & schedule
  
  // Memory banks
  DEADLINES: 'FILE_DEADLINES',         // Active deadlines tracker
  PEOPLE_GRAPH: 'FILE_PEOPLE_GRAPH',   // Relationship network
  INTERACTIONS: 'FILE_INTERACTIONS',   // Communication history
  ACTIVE_THREADS: 'FILE_ACTIVE_THREADS',// Pending conversations
  COMPLETED: 'FILE_COMPLETED',         // Archive
  
  // Operational logs
  EXECUTION_LOG: 'FILE_EXECUTION_LOG', // Action history
  DAILY_SUMMARIES: 'FILE_DAILY_SUMMARIES', // Daily digests
  PENDING_APPROVALS: 'FILE_PENDING_APPROVALS', // Drafts awaiting review
  
  // Learning & state
  BRIEFING_MAP: 'BRIEFING_MAP',        // Briefing queue
  CLUSTERS: 'FILE_CLUSTERS',           // Email clustering data
};

// ============ RELAY CONSTRAINTS ============

const RELAY = {
  MAX_EMAILS_PER_RUN: 15,       // Batch processing limit
  MAX_SEND_PER_DAY: 20,         // Safety throttle
  MAX_URGENT_IN_BRIEFING: 3,    // Urgent items cap
  SEND_QUOTA_RESET_HOURS: 24,
  
  // Search optimization
  SEARCH_BATCH_SIZE: 25,
  SEARCH_MAX_RESULTS: 75,
  BODY_SNIPPET_LENGTH: 250,
};

// ============ CHRONOS SCHEDULE ============

const CHRONOS = {
  COMMAND_CHECK_MINUTES: 2,      // How often to check for user commands
  PROCESS_INTERVAL_MINUTES: 10,  // Email processing frequency
  
  // Briefing schedule (can be overridden in Preferences)
  BRIEFINGS: {
    morning: { hour: 8, enabled: true, label: 'Morning Briefing' },
    midday: { hour: 13, enabled: true, label: 'Midday Check' },
    evening: { hour: 21, enabled: true, label: 'Evening Wrap-up' },
    weekly: { day: WeekDay.SUNDAY, hour: 19, enabled: true, label: 'Weekly Report' }
  }
};

// ============ IDENTITY MARKERS ============

const IDENTITY = {
  PROCESSED_LABEL: 'hermes-processed',
  AGENT_MARKER: '<!--hermes-agent-->',
  BRIEFING_TAG: '[Hermes]',
  VERSION: '3.0.0-PANTHEON',
  NAME: 'Hermes'
};

// ============ AESTHETE DEFAULTS ============

const AESTHETE = {
  DEFAULT_THEME: 'midnight',
  Fallback_THEME: 'default',
  
  // Strict rendering rules
  RULES: {
    MAX_EMAIL_LENGTH: 3000,
    USE_TABLE_LAYOUT: true,       // Never flex/grid (Gmail compatibility)
    INLINE_STYLES_ONLY: true,     // No <style> blocks
    WEB_SAFE_FONTS: ['Arial', 'Helvetica', 'Courier New', 'monospace'],
    FONT_SIZE_RANGE: { min: 10, max: 28, body: 14, heading: 20 },
    NO_UNICODE_EMOJI: true,       // Use HTML entities instead
    MAX_TABLE_NESTING: 4
  }
};

// ============ CACHED CONFIG SINGLETON ============

let _cfgCache = null;

function getConfig() {
  if (_cfgCache) return _cfgCache;
  
  const props = PropertiesService.getScriptProperties();
  
  _cfgCache = {
    // API Keys
    GEMINI_API_KEY: props.getProperty('GEMINI_API_KEY') || '',
    
    // Agent selection
    ORACLE: AGENTS.ORACLE,
    SCRIBE: AGENTS.SCRIBE,
    
    // Models
    GEMINI_MODEL: props.getProperty('GEMINI_MODEL') || AGENTS.SCRIBE.model,
    GEMINI_PRO_MODEL: props.getProperty('GEMINI_PRO_MODEL') || AGENTS.ORACLE.model,
    GEMINI_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/models/',
    
    // VAULT root
    ROOT_FOLDER_ID: props.getProperty('ROOT_FOLDER_ID') || '',
    
    // File mappings (dynamic from VAULT constant)
    ...VAULT,
    
    // Identity
    ...IDENTITY,
    
    // Constraints
    ...RELAY,
    ...CHRONOS,
    ...AESTHETE,
    
    // User context
    USER_EMAIL: Session.getActiveUser().getEmail(),
    NOW: new Date()
  };
  
  return _cfgCache;
}

// ============ PROPERTY ACCESSORS ============

function setProp(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, String(value));
  _cfgCache = null;  // Invalidate cache
}

function getProp(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

function deleteProp(key) {
  PropertiesService.getScriptProperties().deleteProperty(key);
  _cfgCache = null;
}

function getNumProp(key, fallback) {
  const v = getProp(key);
  return v !== null ? Number(v) : fallback;
}

// ============ MODEL SELECTOR ============
// Smart routing: use SCRIBE for cheap tasks, ORACLE for heavy lifting

function selectAgent(capability) {
  const cfg = getConfig();
  
  // Direct capability mapping
  const oracleCapabilities = AGENTS.ORACLE.capabilities;
  const scribeCapabilities = AGENTS.SCRIBE.capabilities;
  
  if (oracleCapabilities.includes(capability)) {
    return AGENTS.ORACLE;
  }
  
  if (scribeCapabilities.includes(capability)) {
    return AGENTS.SCRIBE;
  }
  
  // Default to SSCRIBE for unknown (cheaper)
  console.warn(`Unknown capability '${capability}', defaulting to SCRIBE`);
  return AGENTS.SCRIBE;
}

// ============ VALIDATION ============

function validateConfig() {
  const cfg = getConfig();
  const errors = [];
  
  if (!cfg.GEMINI_API_KEY || cfg.GEMINI_API_KEY === 'PASTE_YOUR_GEMINI_API_KEY_HERE') {
    errors.push('❌ GEMINI_API_KEY not set. Get from: https://aistudio.google.com/apikey');
  }
  
  if (!cfg.ROOT_FOLDER_ID) {
    errors.push('⚠️ ROOT_FOLDER_ID not set. Will use script folder.');
  }
  
  if (errors.length > 0) {
    throw new Error('CONFIG VALIDATION FAILED:\n' + errors.join('\n'));
  }
  
  console.log('✅ Config validated. Agents ready.');
  return true;
}