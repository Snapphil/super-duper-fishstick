/**
 * ============================================
 *  HERMES — ResearchEngine.gs
 *  Multi-step autonomous research
 *  Max 7 tool calls per invocation
 * ============================================
 */

/**
 * Conduct autonomous multi-step research.
 * Plans → Searches → Analyzes gaps → Fills gaps → Synthesizes
 */
function conductResearch(userQuestion, conversationContext) {
  const startTime = Date.now();
  const budget = { gemini: 0, gmail: 0, MAX: 7 };
  const allEmails = [];
  const searchLog = [];

  // ── STEP 1: PLAN ──
  const plan = planResearch_(userQuestion, conversationContext);
  budget.gemini++;

  console.log(`🔬 Research plan: ${plan.searches.length} searches, framework: ${plan.framework}`);

  // ── STEP 2: EXECUTE INITIAL SEARCHES ──
  const initialSearches = (plan.searches || []).slice(0, 4);
  for (const s of initialSearches) {
    if (budget.gmail + budget.gemini >= budget.MAX - 1) break;
    const emails = searchEmails(s.query, s.max_results || 25);
    searchLog.push({ query: s.query, purpose: s.purpose, found: emails.length });
    // Deduplicate by threadId
    const seen = new Set(allEmails.map(e => e.threadId));
    emails.forEach(e => { if (!seen.has(e.threadId)) { allEmails.push(e); seen.add(e.threadId); } });
    budget.gmail++;
  }

  console.log(`🔬 Initial: ${allEmails.length} emails from ${searchLog.length} queries`);

  // ── STEP 3: ANALYZE + FIND GAPS ──
  let refinement = null;
  if (budget.gmail + budget.gemini < budget.MAX - 1 && allEmails.length > 0) {
    refinement = analyzeGaps_(userQuestion, allEmails, searchLog, plan, conversationContext);
    budget.gemini++;

    // ── STEP 4: FILL GAPS ──
    const followUps = (refinement.follow_up_searches || []).slice(0, 3);
    for (const fs of followUps) {
      if (budget.gmail + budget.gemini >= budget.MAX - 1) break;
      const more = searchEmails(fs.query, fs.max_results || 15);
      searchLog.push({ query: fs.query, purpose: fs.purpose, found: more.length, phase: 'gap-fill' });
      const seen = new Set(allEmails.map(e => e.threadId));
      more.forEach(e => { if (!seen.has(e.threadId)) { allEmails.push(e); seen.add(e.threadId); } });
      budget.gmail++;
    }
    console.log(`🔬 After gap-fill: ${allEmails.length} total emails`);
  }

  // ── STEP 5: SYNTHESIZE ──
  const answer = synthesizeResearch_(
    userQuestion, allEmails, searchLog, plan, refinement, conversationContext
  );
  budget.gemini++;

  const stats = {
    toolCalls: budget.gemini + budget.gmail,
    geminiCalls: budget.gemini,
    gmailSearches: budget.gmail,
    emailsFound: allEmails.length,
    timeMs: Date.now() - startTime
  };

  console.log(`🔬 Research done: ${stats.toolCalls} tool calls, ${allEmails.length} emails, ${stats.timeMs}ms`);

  return { answer, stats };
}

// ─── STEP 1: Research Planner ───

function planResearch_(question, conversationCtx) {
  const agentMd = getAgentMd();
  const now = new Date();

  const sys = `You are a forensic research planner. Your job: design the perfect search strategy to answer a question by searching someone's Gmail inbox.

ABOUT THE HUMAN:
${agentMd}

TODAY: ${now.toISOString()} (${getDayName(now)})

CONVERSATION SO FAR:
${conversationCtx}

━━━ YOUR TASK ━━━
Given the human's question, design a multi-pronged search strategy. Think like an investigator:

1. SEMANTIC EXPANSION — The same information gets worded 50 different ways. A "job rejection" could be:
   • "we regret to inform" / "unfortunately" / "not moving forward" / "other candidates" / "decided to pursue" / "will not be proceeding"
   • "after careful consideration" / "we appreciate your interest" / "unable to offer" / "position has been filled"
   • Subject lines: "Application Update" / "Your Application" / "RE: [Role]" / "Update on your candidacy"
   • LinkedIn: "application was reviewed" / "hiring team has decided"
   • ATS: from noreply@greenhouse.io, jobs-noreply@linkedin.com, no-reply@hire.lever.co

2. TEMPORAL STRATEGY — Break time ranges into chunks. Don't search "last 2 years" in one query — split by quarter or half-year.

3. CROSS-REFERENCING — Look for adjacent evidence:
   • If searching rejections → also search for application confirmations (to find ghosting)
   • If searching events → also search for calendar invites, RSVP confirmations
   • If searching about a person → also search for their name in different contexts

4. COUNTER-EVIDENCE — What SHOULD exist but might not? (e.g., companies that never responded = ghosting)

5. PLATFORM PATTERNS — Different platforms format emails differently:
   • LinkedIn: from "messages-noreply@linkedin.com", specific subject patterns
   • Greenhouse: from specific noreply addresses
   • Direct from HR: varies wildly

Return JSON:
{
  "searches": [
    {
      "query": "Gmail search query using proper operators (after:, before:, from:, subject:, OR, quotes)",
      "purpose": "What this search aims to find",
      "max_results": 20,
      "priority": 1
    }
  ],
  "framework": "The analytical framework to apply: funnel_analysis|timeline_reconstruction|pattern_detection|relationship_mapping|sentiment_tracking|behavioral_forensics",
  "hypothesis": "Your initial hypothesis about what we'll find",
  "blind_spots": "What might we miss and why"
}

━━━ GMAIL SEARCH OPERATORS ━━━
after:YYYY/MM/DD  before:YYYY/MM/DD  from:email  to:email
subject:(word1 OR word2)  "exact phrase"  (word1 OR word2)
has:attachment  -word (exclude)  newer_than:Nd  older_than:Nd
label:name  in:anywhere  category:primary

━━━ RULES ━━━
• Generate 3-5 searches, ordered by priority
• Each query should be DIVERSE — don't repeat the same keywords
• Use OR operators liberally for semantic coverage
• Split time ranges for questions spanning >6 months
• Always include at least one "counter-evidence" or "adjacent" search
• Be aggressive with max_results for broad questions (30-50)
• Conservative for narrow questions (10-15)`;

  return callGeminiJson_(
    `RESEARCH QUESTION: ${question}`,
    sys,
    { model: getConfig().GEMINI_MODEL, temperature: 0.2, maxTokens: 2048 }
  );
}

// ─── STEP 3: Gap Analyzer ───

function analyzeGaps_(question, emails, searchLog, plan, conversationCtx) {
  const emailSummaries = emails.slice(0, 40).map((e, i) =>
    `[${i+1}] FROM: ${e.from} | SUBJ: ${e.subject} | DATE: ${e.date} | SNIPPET: ${truncate(e.snippet || e.body, 120)}`
  ).join('\n');

  const searchSummary = searchLog.map(s =>
    `• "${s.query}" → ${s.found} results (${s.purpose})`
  ).join('\n');

  const sys = `You are a research analyst reviewing initial search results for gaps and blind spots.

ORIGINAL QUESTION: ${question}
HYPOTHESIS: ${plan.hypothesis || 'none'}
FRAMEWORK: ${plan.framework || 'general'}

SEARCHES EXECUTED:
${searchSummary}

RESULTS FOUND (${emails.length} total):
${emailSummaries}

${emails.length > 40 ? `... and ${emails.length - 40} more` : ''}

CONVERSATION CONTEXT:
${conversationCtx}

━━━ TASK ━━━
Analyze what we found and what's MISSING. Think:
• Time gaps — are there months with zero results that seem suspicious?
• Category gaps — did we miss a type of email? (e.g., found LinkedIn rejections but not direct HR emails)
• Counter-evidence — did we find any positive signals (interviews, offers) to compare against?
• Anomalies — anything unexpected in the data?

Return JSON:
{
  "initial_findings": "2-3 sentence summary of what the data shows so far",
  "gaps_identified": ["gap 1", "gap 2"],
  "anomalies": ["anything unexpected"],
  "follow_up_searches": [
    {
      "query": "Gmail query to fill the gap",
      "purpose": "What this will find",
      "max_results": 15
    }
  ],
  "confidence": 0.0-1.0,
  "refined_hypothesis": "Updated hypothesis based on what we found"
}`;

  return callGeminiJson_('Analyze gaps.', sys, {
    model: getConfig().GEMINI_MODEL,
    temperature: 0.2,
    maxTokens: 2048
  });
}

// ─── STEP 5: Synthesizer ───

function synthesizeResearch_(question, emails, searchLog, plan, refinement, conversationCtx) {
  // For large email sets, chunk and pre-summarize
  let emailContent;
  if (emails.length > 25) {
    emailContent = chunkAndSummarize_(emails, question);
  } else {
    emailContent = emails.map((e, i) =>
      `━ EMAIL ${i+1} ━\nFROM: ${e.from}\nSUBJECT: ${e.subject}\nDATE: ${e.date}\n${truncate(e.body, 800)}`
    ).join('\n\n');
  }

  const searchSummary = searchLog.map(s =>
    `• ${s.purpose}: ${s.found} results${s.phase ? ' ('+s.phase+')' : ''}`
  ).join('\n');

  const sys = `You are Hermes ⚡ — a brilliant analyst who thinks like a detective and communicates like a sharp chief of staff.

RESEARCH CONTEXT:
• Question: ${question}
• Framework: ${plan.framework || 'general'}
• Hypothesis: ${refinement?.refined_hypothesis || plan.hypothesis || 'none'}
• Gaps found: ${(refinement?.gaps_identified || []).join(', ') || 'none'}
• Anomalies: ${(refinement?.anomalies || []).join(', ') || 'none'}
• Total emails analyzed: ${emails.length}

SEARCHES RUN:
${searchSummary}

CONVERSATION HISTORY:
${conversationCtx}

━━━ OUTPUT FORMAT ━━━
Respond in clean, email-safe HTML with inline styles. Dark theme (background will be #111, text #aaa/#ccc/#fff).

Structure your response as:

1. HEADLINE INSIGHT — One bold sentence. The answer, not the preamble.

2. KEY METRICS — Use a visual stat row:
<div style="display:flex;gap:20px;margin:16px 0;">
  <div><div style="font-size:28px;font-weight:800;color:#ef4444;">NUMBER</div><div style="font-size:10px;color:#555;text-transform:uppercase;">LABEL</div></div>
</div>

3. PATTERN ANALYSIS — Use color-coded items:
• 🔴 for critical/high-frequency patterns
• 🟡 for notable patterns  
• ⚪ for minor/informational
Each pattern: emoji + bold label + percentage/count + one-line explanation

4. NON-OBVIOUS INSIGHTS — Things the human didn't ask about but should know. Use:
<div style="border-left:3px solid #8b5cf6;padding:8px 12px;margin:12px 0;background:#0a0a0a;border-radius:0 6px 6px 0;">insight text</div>

5. ACTIONABLE RECOMMENDATIONS — Specific, numbered, opinionated. Not "consider" — "do this."

━━━ STYLE RULES ━━━
• NEVER start with "Based on my analysis" or "I found" — start with the insight
• Every sentence must carry information. Zero filler.
• Use <strong style="color:#fff;"> for key terms
• Numbers are always bolded and sized up
• Quantify everything — percentages, counts, timeframes
• Be opinionated. Say "Your resume isn't getting past ATS" not "It appears your resume may face challenges"
• If you spot something the human should worry about, flag it directly
• If data is incomplete, say what's missing and what it likely means — don't hedge
• Sound like a brilliant friend who happens to be a data analyst, not a report generator
• Maximum 400 words. Density over length.
• Sign off with a one-line suggested next action in <code> tags`;

  const result = callGemini_(
    `EMAILS:\n${emailContent}\n\nSYNTHESIZE.`,
    sys,
    { model: getConfig().GEMINI_PRO_MODEL || getConfig().GEMINI_MODEL, temperature: 0.4, maxTokens: 4096 }
  );

  return result.text.trim();
}

// ─── Helpers ───

function chunkAndSummarize_(emails, question) {
  const CHUNK = 15;
  const summaries = [];

  for (let i = 0; i < emails.length; i += CHUNK) {
    const chunk = emails.slice(i, i + CHUNK);
    const content = chunk.map((e, j) =>
      `[${i+j+1}] ${e.from} | ${e.subject} | ${e.date} | ${truncate(e.body, 400)}`
    ).join('\n');

    try {
      const result = callGemini_(
        `Extract ALL items relevant to: "${question}"\n\nEMAILS:\n${content}\n\nReturn bullet points with dates, names, and key details. If nothing relevant, say "none."`,
        'You are extracting relevant data points from emails. Be precise. Include dates, company names, role titles, and any stated reasons. Bullet points only.',
        { model: getConfig().GEMINI_MODEL, temperature: 0.1, maxTokens: 1024 }
      );
      if (!result.text.toLowerCase().includes('none')) {
        summaries.push(result.text.trim());
      }
    } catch(e) {
      console.warn(`Chunk summarize failed: ${e.message}`);
    }
  }

  return summaries.join('\n\n---\n\n');
}

/**
 * Quick research for simpler follow-up questions.
 * Uses 2-3 tool calls instead of full 7.
 */
function quickResearch(searchQueries, userQuestion, conversationCtx) {
  // Execute searches
  const allEmails = [];
  const seen = new Set();

  for (const sq of searchQueries.slice(0, 3)) {
    const emails = searchEmails(sq.query, sq.max_results || 20);
    emails.forEach(e => {
      if (!seen.has(e.threadId)) { allEmails.push(e); seen.add(e.threadId); }
    });
  }

  if (allEmails.length === 0) return null;

  // Single-pass synthesis
  const emailContent = allEmails.slice(0, 20).map((e, i) =>
    `━ ${i+1} ━ FROM: ${e.from} | SUBJ: ${e.subject} | DATE: ${e.date}\n${truncate(e.body, 600)}`
  ).join('\n\n');

  const sys = `You are Hermes ⚡. Answer the question using these emails.

CONVERSATION:
${conversationCtx}

RULES:
• Output email-safe HTML with inline styles (dark theme, bg #111)
• Bold key details with <strong style="color:#fff;">
• Be precise and concise — 200 words max
• Use bullet points, not paragraphs
• If the answer is a simple fact, give the fact. Don't pad it.
• Don't start with "Based on" or "I found" — just answer`;

  const result = callGemini_(
    `QUESTION: ${userQuestion}\n\nEMAILS (${allEmails.length}):\n${emailContent}`,
    sys,
    { model: getConfig().GEMINI_MODEL, temperature: 0.3, maxTokens: 2048 }
  );

  return {
    answer: result.text.trim(),
    stats: { emailsFound: allEmails.length, queriesRun: searchQueries.length }
  };
}