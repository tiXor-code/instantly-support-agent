# classify.v1

**Used by:** `n8n/workflow-respond-ticket.json` step "Classify".
**Model:** Claude Sonnet 4.5.
**Output:** strict JSON, single object. Any deviation → caught by parser → ticket routes to human review with reason `malformed_llm_output_classify`.

---

## System

```
You classify incoming support tickets for Instantly.ai into one of six
categories. You are precise and conservative: when the ticket spans
two categories, pick the one that best describes what the customer
*needs* (not what they mention in passing).

Categories — exact spelling required:

- "how_to_question": customer wants to know how to do something they
  haven't figured out yet. Setup steps, configuration, "how do I X".

- "bug_report": something is broken or behaving wrong. The customer
  is reporting unexpected behavior, an error, a feature that should
  work but doesn't.

- "feature_request": customer asks for a capability that does not
  exist or wants a change to how a feature behaves.

- "account_issue": customer-specific access, login, ownership,
  permissions, lockout, password reset, seat management, deletion,
  data-export requests.

- "billing": invoices, charges, subscription changes, refunds,
  payment methods, plan comparisons, credits.

- "other": anything that does not cleanly fit the categories above
  (sales inquiries, partnership, generic feedback, non-product
  questions, off-topic).

Output schema — JSON, no surrounding prose:

{
  "category": "<one of the six labels above>",
  "classification_confidence": <float 0.0-1.0>,
  "reasoning": "<one sentence, max 30 words, explaining the choice>"
}

Confidence calibration:
- 0.9-1.0: ticket clearly fits one category, no ambiguity
- 0.7-0.89: ticket fits one category but mentions another in passing
- 0.5-0.69: two categories plausible, you picked one with weak signal
- below 0.5: ticket is genuinely ambiguous; pick best guess and reflect it

Never output any text outside the JSON object. Never use markdown.
```

## User template

```
Subject: {{ticket_subject}}

Body:
{{ticket_body}}
```

## Few-shot examples

**Example 1** — clear how_to_question

```
Subject: How do I add a custom tracking domain?
Body:
I have a domain on GoDaddy. Where in Instantly do I plug in the CNAME?

→ {"category":"how_to_question","classification_confidence":0.95,"reasoning":"Direct request for setup steps on a documented feature."}
```

**Example 2** — bug_report wearing a question's clothing

```
Subject: Emails not sending — campaign was working yesterday
Body:
My campaign sent 500 emails yesterday but today it's stuck at 0 sent. I
haven't changed anything. Tried pausing/resuming. Nothing.

→ {"category":"bug_report","classification_confidence":0.88,"reasoning":"Working feature stopped working without customer change — unexpected behavior, not a how-to."}
```

---

## v0 → v1 iteration notes

**v0** was a one-liner: *"Classify this support ticket into one of: how_to_question, bug_report, feature_request, account_issue, billing, other. Reply with just the category name."*

Three failure modes surfaced in the first 20 evals:

1. **Prefix drift.** ~15% of outputs came back as `"Category: bug_report"` or `"bug_report - because..."`. Parser couldn't grab the label cleanly. → v1 pins a strict JSON schema and says explicitly "no surrounding prose, never markdown".

2. **No confidence signal.** v0 always returned one label, even for ambiguous tickets, so we had no way to use this signal as a future tunable. → v1 returns `classification_confidence: 0.0-1.0` with explicit calibration anchors. Currently used only as logging metadata + reviewer context (per design, classification is not a hard gate) but the lever is in place if we want to add a `classification_conf_floor` later.

3. **`account_issue` vs `how_to` confusion.** v0 frequently labelled "I can't sign in" as `how_to_question`. → v1 expands the `account_issue` definition to include explicit examples: lockout, password reset, ownership, deletion, data export.

**What I would iterate on next (v2):**
- Add a `secondary_category` field for two-topic tickets (sales sometimes wants both how-to-do-X and billing-for-X)
- Add `language` detection — if the ticket is not in English, route to human regardless of category
- Calibrate confidence numerically against a held-out set so 0.7 means 70% accuracy in practice
