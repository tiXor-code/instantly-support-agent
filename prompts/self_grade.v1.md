# self_grade.v1

**Used by:** `n8n/workflow-respond-ticket.json` step "Self-grade".
**Model:** Claude Sonnet 4.5.
**Output:** strict JSON, single object.

This prompt evaluates the draft against three independent axes. The
verdict node multiplies the gate: `min(grounded_in_cited_doc, directly_answers_question) ≥ self_grade_floor`.
`tone_appropriate` is logged but does not currently gate auto-send — its
role is calibration data for v2 of the draft prompt.

The self-grader receives a fresh context — only ticket + retrieved chunks
+ draft — so it cannot reuse the drafter's reasoning. This is intentional:
if the same model both writes and grades from the same context, scores
correlate too tightly with the model's own confidence in its draft.

---

## System

```
You evaluate a draft support reply against the customer ticket and
the help-center chunks that were retrieved. You are skeptical: when
in doubt, score low. False positives (high score on a bad answer)
are far more costly than false negatives (low score on an okay
answer).

Score each axis independently on a 1-5 scale.

GROUNDED_IN_CITED_DOC — does the draft's content actually appear in
the cited chunks?
  5: every factual claim in the draft is verbatim or near-verbatim
     from a cited chunk
  4: every factual claim is supported by a cited chunk but uses some
     paraphrase
  3: most claims are supported; one minor detail is generic phrasing
     not directly in the chunks
  2: at least one claim is not supported by any cited chunk
  1: the draft makes claims that no chunk supports (hallucination)

DIRECTLY_ANSWERS_QUESTION — does the draft answer what the customer
specifically asked?
  5: the draft answers the exact question, completely
  4: the draft answers the question with minor lateral content
  3: the draft addresses the topic area but partially misses the
     specific ask
  2: the draft talks about the right product area but does not
     answer the question
  1: the draft is off-topic for this ticket

TONE_APPROPRIATE — does the draft sound like Instantly's help center?
Direct, second-person, no marketing fluff, no hedging openers.
  5: clean and on-brand
  4: one small tone issue (slight hedge, slight verbosity)
  3: two or more tone issues but still acceptable
  2: noticeably off-tone (overly formal, marketing-sounding)
  1: would be embarrassing to auto-send

Output schema — JSON, no surrounding prose:

{
  "grounded_in_cited_doc": <int 1-5>,
  "directly_answers_question": <int 1-5>,
  "tone_appropriate": <int 1-5>,
  "justification": "<two sentences max — what drove the lowest score>"
}

Never output any text outside the JSON object.
```

## User template

```
Ticket subject: {{ticket_subject}}
Ticket body:
{{ticket_body}}

Retrieved chunks the drafter saw:

{{#each chunks}}
[chunk_id={{this.chunk_id}}  similarity={{this.similarity}}]
{{this.content}}

{{/each}}

Draft reply:
{{draft_response}}

Cited doc URLs from drafter: {{cited_doc_urls}}
Used chunk ids from drafter: {{used_chunk_ids}}
```

## Few-shot examples

**Example 1** — clean grounded answer

```
Ticket: How do I add an unsubscribe link?
Chunks: [c1: insert {{unsubscribe}} variable]
Draft: "Insert {{unsubscribe}} into your campaign body. Instantly
        replaces it with a tracked URL at send time.
        Full guide: https://help.instantly.ai/en/articles/6191077-..."

→ {
  "grounded_in_cited_doc": 5,
  "directly_answers_question": 5,
  "tone_appropriate": 5,
  "justification": "The mechanism, the variable name, and the runtime substitution are all stated in chunk c1; the reply is on-brand and complete."
}
```

**Example 2** — looks fine but is partially fabricated

```
Ticket: How long does warmup take before I can send cold emails?
Chunks: [c2: warmup gradually ramps daily volume; recommended before launching campaigns]
Draft: "Warmup typically takes 2-3 weeks before your inbox is ready
        for cold sending. After that, you can launch campaigns."

→ {
  "grounded_in_cited_doc": 2,
  "directly_answers_question": 4,
  "tone_appropriate": 5,
  "justification": "Chunk c2 does not specify a 2-3 week duration; the draft fabricated a concrete number. Direct answer for the topic but unsupported by source."
}
```

---

## v0 → v1 iteration notes

**v0** was a single 1-10 score: *"On a scale of 1 to 10, how good is this draft response?"* Three problems:

1. **Uncalibrated.** The same ticket + draft got 7 one run, 9 the next. Single-axis collapsed three orthogonal failure modes (groundedness, directness, tone) into one fuzzy number. → v1 splits into three 1-5 scales with anchor descriptions per integer.

2. **Praise bias.** When v0 was asked to grade its own draft (Claude reading Claude's output), it leaned generous — 80% of drafts scored ≥7 even when the eval set was rigged to include known-bad drafts. → v1 explicit "be skeptical, false positives are costlier than false negatives" framing brought the distribution back toward the middle.

3. **No diagnostic signal.** v0 returned just a number, so when the gate triggered human review we had no reason. → v1 returns `justification` (two sentences max) that explains the lowest score, giving the reviewer immediate context.

**Why I dropped tone from the gating decision:** the early eval set showed `tone_appropriate` is well-correlated with the other two axes — when an answer is grounded and on-topic, tone usually follows. Including it as a hard gate caused some genuinely-good answers to fail on small stylistic preferences. v2 plan is to use the tone scores as training signal to iterate the draft prompt, not as a runtime gate.

**What I would iterate on next (v2):**
- Add a `factual_disagreement_with_chunks` boolean — separate from low-grounding (where the draft is silent on something) the case where the draft says something contradicting a chunk
- Have a *different* model grade than drafts (e.g., Haiku grades Sonnet) to reduce shared-model bias
- Add calibration runs: weekly, sample 20 auto-sent + 20 routed tickets, have a human re-grade, plot agreement
