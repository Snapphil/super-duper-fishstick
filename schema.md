# Hermes Schema — Your Operating Preferences

> This file controls how Hermes behaves. Edit it to match your workflow.
> Hermes reads this file at the start of every run. It never modifies it.

---

## Identity

- **Your name**: [Your Name]
- **Your role**: [e.g., Founder, Engineer, Researcher]
- **Your timezone**: America/New_York

---

## Briefing Preferences

- **Frequency**: daily
- **Time**: 7:00 AM
- **Format**: email
- **Detail level**: concise (1-2 sentences per item, full detail only for high priority)
- **Max items**: 15

---

## Priority Contacts

People whose emails always surface, regardless of content:

- [name@example.com] — [relationship context]
- [name@example.com] — [relationship context]

---

## Muted Senders

Emails from these senders are logged but never surfaced in briefings:

- noreply@*
- notifications@github.com
- *@marketing.*.com

---

## Priority Rules

How Hermes decides what matters:

1. **Critical**: Direct email from priority contacts with a question or request
2. **High**: Any email requiring a response within 24 hours
3. **Medium**: FYI emails from known contacts, newsletters you actually read
4. **Low**: Automated notifications, CC'd threads, bulk mail

---

## Communication Style

When Hermes drafts replies on your behalf:

- **Tone**: professional but warm, not corporate
- **Length**: match the sender's length (short reply to short email)
- **Signature**: use my standard Gmail signature
- **Never**: use exclamation marks more than once, use "per my last email", be passive-aggressive
- **Always**: acknowledge what they said before responding, be direct about next steps

---

## Commitment Tracking

What counts as a commitment to track:

- Explicit promises: "I'll send you...", "I'll follow up by..."
- Deadlines mentioned in either direction
- Action items assigned to you in meeting recap emails
- Requests you haven't responded to in 48+ hours

What to ignore:

- Vague pleasantries: "let's grab coffee sometime"
- Auto-generated task assignments from project tools
- Commitments older than 30 days with no follow-up

---

## Compilation Rules

- **People profiles**: Create after 3+ email exchanges with same person
- **Project pages**: Create when 5+ threads cluster around same topic
- **Update frequency**: Every run (not just when new email from that person arrives)
- **Confidence markers**: Use [explicit] and [inferred] tags

---

## Labels

Hermes can apply Gmail labels to processed emails:

- `hermes/briefed` — included in today's briefing
- `hermes/draft-ready` — reply draft created
- `hermes/commitment` — contains a tracked commitment
- `hermes/compiled` — content compiled into wiki
