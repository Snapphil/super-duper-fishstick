/**
 * HERMES — GeminiClient.gs
 * ============================================
 * PANTHEON SYSTEM: Dual-Agent Orchestration Layer
 * 
 * Routes tasks to ORACLE (Pro) or SCRIBE (Flash) based on complexity.
 * Implements retry logic, token budgeting, and error recovery.
 */

// ============ AGENT INVOCATION CORE ============

/**
 * Call appropriate agent based on task type.
 * @param {string} capability - Task type from AGENTS.*.capabilities
 * @param {string} prompt - Main prompt text
 * @param {string} systemPrompt - System instructions
 * @param {Object} options - Override options (model, temperature, etc.)
 * @returns {Object} { text, tokens, raw, modelUsed }
 */
function callAgent_(capability, prompt, systemPrompt, options = {}) {
  const cfg = getConfig();
  const agent = selectAgent(capability);
  
  // Merge defaults with overrides
  const opts = {
    model: options.model || agent.model,
    temperature: options.temperature ?? agent.temperature,
    maxTokens: options.maxTokens || agent.maxTokens,
    ...options
  };
  
  console.log(`🎯 [${agent.id.toUpperCase()}] Capability: ${capability} | Tokens: ${opts.maxTokens}`);
  
  try {
    const result = invokeGeminiAPI_(prompt, systemPrompt, opts);
    return {
      ...result,
      agentUsed: agent.id,
      modelUsed: opts.model,
      capability: capability
    };
  } catch (error) {
    // Fallback strategy: if ORACLE fails, try SCRIBE for simpler version
    if (agent.id === 'ORACLE' && opts.allowFallback !== false) {
      console.warn(`⚠️ ORACLE failed, falling back to SCRIBE: ${error.message}`);
      return callAgent_(capability, prompt, systemPrompt, {
        ...options,
        model: AGENTS.SCRIBE.model,
        temperature: 0.1,
        maxTokens: 1024,
        allowFallback: false
      });
    }
    throw error;
  }
}

/**
 * Low-level Gemini API invocation with robust error handling.
 * @private
 */
function invokeGeminiAPI_(prompt, systemPrompt, options) {
  const cfg = getConfig();
  const { model, temperature, maxTokens } = options;
  
  // Validate prerequisites
  if (!cfg.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY not configured');
  }
  if (!model) {
    throw new Error(`Model undefined — check Config.gs`);
  }
  
  // Build URL
  const url = `${cfg.GEMINI_BASE_URL}${model}:generateContent?key=${cfg.GEMINI_API_KEY}`;
  
  // Build request body
  const body = {
    contents: [{
      parts: [{ text: prompt }]
    }],
    generationConfig: {
      temperature: temperature,
      maxOutputTokens: maxTokens,
      topP: 0.95,
      topK: 40
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
    ]
  };
  
  // Add system instruction if provided
  if (systemPrompt) {
    body.systemInstruction = { parts: [{ text: systemPrompt }] };
  }
  
  // Execute with retry logic
  const resp = fetchWithRetry_(url, {
    method: 'POST',
    payload: JSON.stringify(body),
    contentType: 'application/json',
    muteHttpExceptions: true
  }, 3); // Max 3 retries
  
  // Parse response
  const code = resp.getResponseCode();
  const raw = resp.getContentText();
  
  if (code !== 200) {
    const errorMsg = parseGeminiError_(raw, code);
    throw new Error(`Gemini ${model}: ${errorMsg}`);
  }
  
  // Extract text
  const json = safeJsonParse(raw);
  if (!json?.candidates?.[0]?.content?.parts?.[0]?.text) {
    console.error('Malformed Gemini response:', raw.substring(0, 500));
    throw new Error('Empty or malformed response from Gemini');
  }
  
  const text = json.candidates[0].content.parts[0].text;
  const usageMetadata = json.usageMetadata || {};
  
  return {
    text: text.trim(),
    tokens: usageMetadata.totalTokenCount || 0,
    raw: json,
    model: model
  };
}

// ============ SPECIALIZED INVOKERS ============

/**
 * Call ORACLE for structured JSON response (research, classification).
 * Robust JSON extraction with repair attempts.
 */
function callOracleJson_(capability, prompt, systemPrompt, options = {}) {
  const result = callAgent_(capability, prompt, systemPrompt, {
    ...options,
    model: AGENTS.ORACLE.model,  // Force ORACLE for JSON tasks
    responseType: 'application/json'
  });
  
  // Attempt JSON extraction
  let parsed = extractJson_(result.text);
  
  if (!parsed) {
    console.warn('JSON parse failed, attempting repair...');
    parsed = attemptJsonRepair_(result.text);
  }
  
  if (!parsed) {
    // Last resort: wrap in object
    console.error('JSON extraction completely failed');
    return {
      intent: 'error',
      raw_text: result.text,
      error: 'JSON_parse_failed'
    };
  }
  
  return {
    ...parsed,
    _meta: {
      tokens: result.tokens,
      model: result.modelUsed,
      confidence: result.text.includes('{') ? 0.9 : 0.5
    }
  };
}

/**
 * Call SCRIBE for quick classification (fast, cheap, deterministic).
 */
function callScribeClassify_(email, systemPrompt) {
  const cfg = getConfig();
  
  // Build compact prompt for speed
  const compactPrompt = `CLASSIFY THIS EMAIL:\nFrom: ${email.from}\nSubject: ${email.subject}\nDate: ${email.date}\nBody: ${truncate(email.body, 500)}

Respond JSON only: {"category":"meeting|deadline|noise|personal|urgent|info","urgency":0-10,"needs_reply":bool,"extracted_deadline":"YYYY-MM-DD or null","sender_type":"boss|friend|service|unknown","summary":"one line"}`;

  return callAgent_('email_classification', compactPrompt, systemPrompt || 'You are a precise email classifier. JSON only.', {
    model: AGENTS.SCRIBE.model,
    temperature: 0.05,  // Near-deterministic
    maxTokens: 256
  });
}

// ============ RETRY & ERROR HANDLING ============

/**
 * Fetch with exponential backoff retry.
 * @private
 */
function fetchWithRetry_(url, options, maxRetries = 3) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const resp = UrlFetchApp.fetch(url, options);
      
      // Retry on server errors (5xx) or rate limits (429)
      const code = resp.getResponseCode();
      if (code >= 500 || code === 429) {
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
          console.warn(`⚠️ Retry ${attempt}/${maxRetries} for HTTP ${code}, waiting ${delay}ms`);
          Utilities.sleep(delay);
          continue;
        }
      }
      
      return resp;
      
    } catch (e) {
      lastError = e;
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        console.warn(`⚠️ Network error attempt ${attempt}: ${e.message}, retrying...`);
        Utilities.sleep(delay);
      }
    }
  }
  
  throw lastError || new Error('Max retries exceeded');
}

/**
 * Parse user-friendly error from Gemini error response.
 * @private
 */
function parseGeminiError_(rawBody, httpCode) {
  try {
    const err = safeJsonParse(rawBody);
    const msg = err?.error?.message || rawBody;
    
    // Common error mapping
    if (httpCode === 400) return `Bad Request: ${msg}`;
    if (httpCode === 429) return 'Rate limited. Slow down.';
    if (httpCode === 403) return 'API Key invalid or blocked';
    if (msg.includes('quota')) return 'Quota exceeded';
    if (msg.includes('safety')) return 'Content filtered (safety)';
    
    return msg;
  } catch (e) {
    return `HTTP ${httpCode}: ${rawBody.substring(0, 200)}`;
  }
}

// ============ JSON EXTRACTION UTILITIES ============

/**
 * Extract JSON from text that might be wrapped in markdown or explanation.
 * @private
 */
function extractJson_(text) {
  if (!text) return null;
  
  // Try direct parse first
  const direct = safeJsonParse(text);
  if (direct) return direct;
  
  // Look for JSON block markers
  const patterns = [
    /```json\s*([\s\S]*?)```/i,
    /```\s*(\{[\s\S]*?\})\s*```/,
    /(\{[\s\S]*\})/
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const parsed = safeJsonParse(match[1].trim());
      if (parsed) return parsed;
    }
  }
  
  return null;
}

/**
 * Attempt to repair malformed JSON (unclosed brackets, trailing commas).
 * @private
 */
function attemptJsonRepair_(text) {
  if (!text) return null;
  
  let repaired = text.trim();
  
  // Remove markdown fences
  repaired = repaired.replace(/```json?/gi, '').replace(/```/g, '');
  
  // Find JSON-like content
  const firstBrace = repaired.indexOf('{');
  const lastBrace = repaired.lastIndexOf('}');
  
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }
  
  repaired = repaired.substring(firstBrace, lastBrace + 1);
  
  // Common repairs
  repaired = repaired
    .replace(/,\s*}/g, '}')      // Trailing commas before }
    .replace(/,\s*]/g, ']')      // Trailing commas before ]
    .replace(/[\x00-\x1F\x7F]/g, '') // Control characters
    .trim();
  
  // Balance brackets/braces
  repaired = balanceDelimiters_(repaired);
  
  return safeJsonParse(repaired);
}

/**
 * Ensure brackets and braces are balanced.
 * @private
 */
function balanceDelimiters_(str) {
  const stack = [];
  const pairs = { ']': '[', '}': '{', '"': '"' };
  const openers = Object.values(pairs);
  const closers = Object.keys(pairs);
  
  let inString = false;
  let escaped = false;
  
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    
    if (ch === '"' && !inString) { inString = true; continue; }
    if (ch === '"' && inString) { inString = false; continue; }
    
    if (inString) continue;
    
    if (openers.includes(ch)) {
      stack.push(ch);
    } else if (closers.includes(ch)) {
      if (stack.length > 0 && stack[stack.length - 1] === pairs[ch]) {
        stack.pop();
      } else {
        // Unexpected closer, remove it
        str = str.substring(0, i) + str.substring(i + 1);
        i--; // Recheck this position
      }
    }
  }
  
  // Close any remaining open delimiters
  while (stack.length > 0) {
    const opener = stack.pop();
    const closer = Object.entries(pairs).find(([k, v]) => v === opener)?.[0];
    if (closer) str += closer;
  }
  
  return str;
}