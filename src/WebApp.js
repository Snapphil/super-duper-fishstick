/**
 * ============================================
 *  HERMES — ConversationMemory.gs
 *  Short-term conversation context
 * ============================================
 */

const MAX_CONVERSATION_TURNS = 8;
const CONVERSATION_TTL_MS = 2 * 3600000; // 2 hours

/**
 * Get recent conversation history.
 */
function getConversationHistory() {
  const raw = getProp('CONVERSATION_HISTORY');
  return safeJsonParse(raw) || [];
}

/**
 * Add a turn to conversation history.
 */
function addConversationTurn(role, text) {
  let history = getConversationHistory();

  history.push({
    role: role,
    text: truncate(text, 500),
    timestamp: new Date().toISOString()
  });

  // Keep only recent turns
  while (history.length > MAX_CONVERSATION_TURNS) {
    history.shift();
  }

  // Expire old turns (older than 2 hours = new conversation)
  const cutoff = Date.now() - CONVERSATION_TTL_MS;
  history = history.filter(t => new Date(t.timestamp).getTime() >= cutoff);

  setProp('CONVERSATION_HISTORY', JSON.stringify(history));
}

/**
 * Format conversation history for inclusion in prompts.
 */
function formatConversationHistory() {
  const history = getConversationHistory();
  if (history.length === 0) return 'No recent conversation.';

  return history.map(t => {
    const who = t.role === 'user' ? 'HUMAN' : 'HERMES';
    return `[${who}]: ${t.text}`;
  }).join('\n');
}

/**
 * Store what Hermes just said/did so follow-ups make sense.
 */
function storeHermesResponse(summary, fullContext) {
  addConversationTurn('hermes', summary);
  setProp('LAST_HERMES_RESPONSE', JSON.stringify({
    summary: summary,
    full: truncate(fullContext || summary, 2000),
    timestamp: new Date().toISOString()
  }));
}

/**
 * Get the last detailed Hermes response.
 */
function getLastHermesResponse() {
  return safeJsonParse(getProp('LAST_HERMES_RESPONSE') || '{}') || {};
}

/**
 * Clear conversation (e.g., on explicit reset).
 */
function clearConversation() {
  setProp('CONVERSATION_HISTORY', '[]');
  deleteProp('LAST_HERMES_RESPONSE');
}