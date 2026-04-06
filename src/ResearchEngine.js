/**
 * ============================================
 *  HERMES — ResearchEngine.gs
 *  Multi-step research with null safety
 *  Max 7 tool calls per invocation
 * ============================================
 */

function conductResearch(userQuestion, conversationContext) {
  const startTime = Date.now();
  const budget = { gemini: 0, gmail: 0, MAX: 7 };
  const allEmails = [];
  const searchLog = [];

  // STEP 0: Memory
  let memory;
  try { memory = getMemoryDigest(); } catch (e) {
    Logger.log('[WARN] Memory load failed: ' + e.message);
    memory = { full: 'Memory unavailable.', deadlines: [], upcomingDl: [], people: [], waitingOn: [], activeThreads: [], recentInsights: [], stats: { totalDeadlines: 0, totalPeople: 0, totalThreads: 0, overdueCount: 0 } };
  }

  // STEP 1: Plan
  let plan;
  try {
    plan = planResearch_(userQuestion, conversationContext, memory);
    budget.openai++;
  } catch (e) {
    Logger.log('[ERROR] Research planning failed: ' + e.message);
    plan = { searches: [], framework: 'general', hypothesis: '', memory_covers: '', memory_gaps: '' };
  }

  const searches = Array.isArray(plan.searches) ? plan.searches : [];
  Logger.log(`[RESEARCH] Plan: ${searches.length} searches, framework: ${plan.framework || 'general'}`);

  // STEP 2: Execute searches
  for (const s of searches.slice(0, 4)) {
    if (budget.gmail + budget.openai >= budget.MAX - 1) break;
    if (!s || !s.query) continue;
    try {
      const emails = searchEmails(s.query, s.max_results || 25);
      searchLog.push({ query: s.query, purpose: s.purpose || '', found: emails.length });
      const seen = new Set(allEmails.map(e => e.threadId));
      emails.forEach(e => { if (!seen.has(e.threadId)) { allEmails.push(e); seen.add(e.threadId); } });
      budget.gmail++;
    } catch (e) {
      Logger.log('[WARN] Search failed: ' + e.message);
      searchLog.push({ query: s.query, purpose: s.purpose || '', found: 0, error: e.message });
    }
  }

  Logger.log(`[RESEARCH] Initial: ${allEmails.length} emails from ${searchLog.length} queries`);

  // STEP 3: Gap analysis
  let refinement = null;
  if (budget.gmail + budget.openai < budget.MAX - 1 && allEmails.length > 0) {
    try {
      refinement = analyzeGaps_(userQuestion, allEmails, searchLog, plan, conversationContext);
      budget.openai++;

      // STEP 4: Fill gaps
      const followUps = Array.isArray(refinement.follow_up_searches) ? refinement.follow_up_searches : [];
      for (const fs of followUps.slice(0, 2)) {
        if (budget.gmail + budget.openai >= budget.MAX - 1) break;
        if (!fs || !fs.query) continue;
        try {
          const more = searchEmails(fs.query, fs.max_results || 15);
          searchLog.push({ query: fs.query, purpose: fs.purpose || '', found: more.length, phase: 'gap-fill' });
          const seen = new Set(allEmails.map(e => e.threadId));
          more.forEach(e => { if (!seen.has(e.threadId)) { allEmails.push(e); seen.add(e.threadId); } });
          budget.gmail++;
        } catch (e) { Logger.log('[WARN] Gap-fill search failed: ' + e.message); }
      }
    } catch (e) {
      Logger.log('[WARN] Gap analysis failed: ' + e.message);
    }
  }

  // STEP 5: Synthesize
  let answer;
  try {
    answer = synthesizeResearch_(userQuestion, allEmails, searchLog, plan, refinement, conversationContext, memory);
    budget.openai++;
  } catch (e) {
    Logger.log('[ERROR] Synthesis failed: ' + e.message);
    answer = `<div style="color:${getTheme().accent};">Research synthesis failed: ${escapeHtml(e.message)}</div><br>` +
      `I found ${allEmails.length} emails across ${searchLog.length} searches but couldn't compile results.<br>` +
      `Try a more specific question.`;
  }

  const stats = {
    toolCalls: budget.openai + budget.gmail,
    openaiCalls: budget.openai,
    gmailSearches: budget.gmail,
    queriesRun: budget.gmail,
    emailsFound: allEmails.length,
    timeMs: Date.now() - startTime
  };

  // STEP 6: Update memory
  try {
    if (allEmails.length > 0) updateMemoryFromResearch(userQuestion, answer, allEmails);
  } catch (e) { Logger.log('[WARN] Memory update failed: ' + e.message); }

  return { answer, stats };
}

function planResearch_(question, conversationCtx, memory) {
  const agentMd = getAgentMd();
  const now = new Date();
  const themeCtx = getThemePromptContext();

  const sys = `You are a forensic research planner.

ABOUT THE HUMAN:
${agentMd}

TODAY: ${now.toISOString()} (${getDayName(now)})

CONVERSATION:
${conversationCtx}

EXISTING KNOWLEDGE:
${memory ? memory.full : 'No memory loaded.'}

TASK: Design search strategy. Check memory first.

${themeCtx}

Return JSON:
{
  "memory_relevant": true/false,
  "memory_covers": "What memory already answers",
  "memory_gaps": "What's missing",
  "searches": [
    {"query": "Gmail query using operators", "purpose": "what this finds", "max_results": 20, "priority": 1}
  ],
  "framework": "funnel_analysis|timeline_reconstruction|pattern_detection|relationship_mapping|behavioral_forensics",
  "hypothesis": "initial hypothesis",
  "blind_spots": "what we might miss"
}

GMAIL OPERATORS: after:YYYY/MM/DD before:YYYY/MM/DD from: to: subject:() "exact" (OR) -exclude has:attachment newer_than:Nd

RULES:
• 3-5 diverse searches, liberal OR usage
• Split time ranges >6 months
• Include semantic variants (rejections: "not moving forward" OR "other candidates" OR "regret" etc.)
• searches MUST be a non-empty array`;

  return callOpenAIJson_(`RESEARCH: ${question}`, sys, {
    model: getConfig().OPENAI_MODEL, temperature: 0.2, maxTokens: 2048
  });
}

function analyzeGaps_(question, emails, searchLog, plan, conversationCtx) {
  const summaries = emails.slice(0, 40).map((e, i) =>
    `[${i + 1}] ${e.from} | ${e.subject} | ${e.date} | ${truncate(e.snippet || '', 120)}`
  ).join('\n');

  const searchSummary = searchLog.map(s => `• "${s.query}" → ${s.found} (${s.purpose || ''})`).join('\n');

  return callOpenAIJson_('Analyze gaps.', `Gap analysis. Q: ${question}. Hypothesis: ${plan.hypothesis || 'none'}.

SEARCHES:
${searchSummary}

RESULTS (${emails.length}):
${summaries}

Return JSON: {"initial_findings":"...","gaps_identified":[],"anomalies":[],"follow_up_searches":[{"query":"...","purpose":"...","max_results":15}],"confidence":0.5,"refined_hypothesis":"..."}
follow_up_searches MUST be an array (empty is OK).`, {
    model: getConfig().OPENAI_MODEL, temperature: 0.2, maxTokens: 2048
  });
}

function synthesizeResearch_(question, emails, searchLog, plan, refinement, conversationCtx, memory) {
  let emailContent;
  if (emails.length > 25) {
    emailContent = chunkAndSummarize_(emails, question);
  } else {
    emailContent = emails.map((e, i) =>
      `━ ${i + 1} ━\nFROM: ${e.from}\nSUBJ: ${e.subject}\nDATE: ${e.date}\n${truncate(e.body || '', 800)}`
    ).join('\n\n');
  }

  const t = getTheme();
  const themeCtx = getThemePromptContext();
  const searchSummary = searchLog.map(s => `• ${s.purpose || s.query}: ${s.found} results`).join('\n');
  const memoryDl = (memory && memory.upcomingDl) ? memory.upcomingDl.map(d => `• ${d.description} — ${d.date}`).join('\n') : 'None';

  const sys = `You are Hermes ⚡ — brilliant analyst, sharp communicator.

CONTEXT:
Question: ${question}
Framework: ${plan.framework || 'general'}
Hypothesis: ${refinement?.refined_hypothesis || plan.hypothesis || 'none'}
Gaps: ${(refinement?.gaps_identified || []).join(', ') || 'none'}
Emails: ${emails.length}
Memory deadlines: ${memoryDl}
Searches: ${searchSummary}
Conversation: ${conversationCtx}

${themeCtx}

━━━ OUTPUT ━━━
Generate email-safe HTML using the EXACT theme colors above in inline styles.
ALL layout must use <table> tags (no display:flex — breaks Gmail mobile).
Use width="100%" on tables. All styles inline.

Structure:
1. HEADLINE — Bold opening insight (not "Based on my analysis")
2. KEY METRICS — Use a table row with big numbers:
<table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
  <td width="25%" style="text-align:center;padding:8px;"><div style="font-size:26px;font-weight:800;color:${t.accent};">NUM</div><div style="font-size:9px;color:${t.textDim};text-transform:uppercase;">LABEL</div></td>
</tr></table>

3. DETAILS — Organized with color-coded bullets (🔴🟡⚪), <strong style="color:${t.textBright};"> for emphasis
4. NON-OBVIOUS INSIGHTS in accent boxes:
<div style="border-left:3px solid ${t.accent2};padding:8px 12px;margin:10px 0;background:${t.bg};color:${t.text};font-size:13px;">insight</div>

5. MEMORY UPDATE — Tell human what you saved: "Added X deadlines and Y contacts to memory."
6. NEXT ACTION in <code style="color:${t.textMuted};background:${t.bg};padding:2px 6px;border-radius:3px;">command</code>

RULES:
• Never start with "Based on" / "I found" — insight first
• Quantify everything. Be opinionated.
• Max 400 words. Dense.
• ALL colors from theme. ALL layout with tables.`;

  const result = callOpenAI_(
    `EMAILS:\n${emailContent}\n\nSYNTHESIZE.`,
    sys,
    { model: getConfig().OPENAI_PRO_MODEL || getConfig().OPENAI_MODEL, temperature: 0.4, maxTokens: 4096 }
  );
  return result.text.trim();
}

function chunkAndSummarize_(emails, question) {
  const CHUNK = 15;
  const summaries = [];
  for (let i = 0; i < emails.length; i += CHUNK) {
    const chunk = emails.slice(i, i + CHUNK);
    const content = chunk.map((e, j) =>
      `[${i + j + 1}] ${e.from} | ${e.subject} | ${e.date} | ${truncate(e.body || '', 400)}`
    ).join('\n');
    try {
      const result = callOpenAI_(
        `Extract items relevant to: "${question}"\n\nEMAILS:\n${content}\n\nBullets with dates+names. "none" if nothing.`,
        'Extract relevant data. Precise. Bullet points.', { model: getConfig().OPENAI_MODEL, temperature: 0.1, maxTokens: 1024 }
      );
      if (!result.text.toLowerCase().includes('none')) summaries.push(result.text.trim());
    } catch (e) { Logger.log('[WARN] Chunk failed: ' + e.message); }
  }
  return summaries.join('\n\n---\n\n');
}

function quickResearch(searchQueries, userQuestion, conversationCtx, memory) {
  const queries = Array.isArray(searchQueries) ? searchQueries : [];
  if (queries.length === 0) return null;

  const allEmails = [];
  const seen = new Set();
  for (const sq of queries.slice(0, 3)) {
    if (!sq || !sq.query) continue;
    try {
      const emails = searchEmails(sq.query, sq.max_results || 20);
      emails.forEach(e => { if (!seen.has(e.threadId)) { allEmails.push(e); seen.add(e.threadId); } });
    } catch (e) { Logger.log('[WARN] Quick search failed: ' + e.message); }
  }

  if (allEmails.length === 0) return null;

  const t = getTheme();
  const themeCtx = getThemePromptContext();
  const emailContent = allEmails.slice(0, 20).map((e, i) =>
    `━ ${i + 1} ━ ${e.from} | ${e.subject} | ${e.date}\n${truncate(e.body || '', 600)}`
  ).join('\n\n');

  const memCtx = memory ? `\nMEMORY:\n${memory.full}\n` : '';

  const result = callOpenAI_(
    `QUESTION: ${userQuestion}\n\nEMAILS (${allEmails.length}):\n${emailContent}`,
    `You are Hermes ⚡. Answer using emails + memory. ${memCtx}
${themeCtx}
RULES: Email-safe HTML, inline styles, table layout (no flex), theme colors. 200 words max. Dense. Don't start with "Based on".`,
    { model: getConfig().OPENAI_MODEL, temperature: 0.3, maxTokens: 2048 }
  );

  try { updateMemoryFromResearch(userQuestion, result.text, allEmails); } catch (e) { }

  return { answer: result.text.trim(), stats: { emailsFound: allEmails.length, queriesRun: queries.length } };
}

// ============ Research path aliases (Gmail / Gemini / memory naming) ============

function searchEmails(query, maxResults) {
  return searchEmails_(query, maxResults);
}

function getAgentMd() {
  return getAgentMd_();
}

function getMemoryDigest() {
  const d = getMemoryDigest_();
  const structured = d.structured || {};
  return {
    full: d.full,
    stats: d.stats,
    deadlines: structured.deadlines,
    upcomingDl: structured.upcoming || [],
    overdue: structured.overdue,
    people: structured.people,
    waitingOn: structured.waitingOn,
    activeThreads: structured.activeThreads,
    recentInsights: structured.recentInsights
  };
}

function callOpenAI_(prompt, systemPrompt, options) {
  options = options || {};
  const capability = options.capability || 'research_synthesis';
  return callAgent_(capability, prompt, systemPrompt, options);
}

function callOpenAIJson_(prompt, systemPrompt, options) {
  options = options || {};
  return callOracleJson_(options.capability || 'research_synthesis', prompt, systemPrompt, options);
}
