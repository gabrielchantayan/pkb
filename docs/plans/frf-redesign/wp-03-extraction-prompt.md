# WP-03: Extraction Prompt Rewrite

**Phase:** 2
**Depends on:** WP-01 (DB Migration & Shared Types)
**Complexity:** Medium

## Goal

Complete rewrite of the extraction prompt and response parsing in `extraction.ts` to support batch input, new fact types, free-form relationship labels, quality-focused extraction, and Gemini structured output mode (JSON mode). This replaces the current single-message extraction with a batch-aware prompt that receives pre-formatted message blocks.

## Background

The current extraction prompt in `packages/backend/src/services/ai/extraction.ts` is a simple template that takes a single message's `{content}`, `{contact_name}`, and `{direction}`, asks for facts from a limited set of types (`birthday`, `location`, `job_title`, `company`, `custom`), uses a hardcoded list of relationship labels, and has a confidence threshold of 0.6.

The new prompt must:
- Accept a pre-formatted batch of messages (formatted by the batching service, WP-02)
- Support all 13 fact types including new ones: `preference`, `tool`, `hobby`, `opinion`, `life_event`, `goal`
- Use free-form relationship labels instead of a fixed list
- Include quality mandate with good/bad examples
- Raise confidence threshold to 0.75 (configurable)
- Use Gemini structured output / JSON mode for guaranteed valid responses
- Clearly differentiate context-only vs extractable messages

The Gemini SDK (`@google/generative-ai`) supports structured output via `responseMimeType: 'application/json'` and `responseSchema`. The current `gemini.ts` wrapper uses `model.generateContent(prompt)` which returns plain text. A new function is needed that uses JSON mode.

**Existing patterns to follow:**
- `packages/backend/src/services/ai/extraction.ts` — current prompt and parsing (to be rewritten)
- `packages/backend/src/services/ai/gemini.ts` — Gemini SDK wrapper (to add structured output function)

## Scope

**In scope:**
- Rewrite `EXTRACTION_PROMPT` in `extraction.ts` with:
  - Quality mandate with explicit good/bad examples
  - All 13 fact types with descriptions
  - Free-form relationship labels with suggested examples
  - Source-type awareness (email vs SMS style differences)
  - Clear context-only vs extractable message instruction
  - Explicit instruction that empty arrays are correct
- Change `extract_from_text()` to `extract_from_batch()` that accepts a pre-formatted batch string and contact name
- Add `generate_with_flash_json()` to `gemini.ts` that uses `responseMimeType: 'application/json'` and `responseSchema`
- Update `ExtractionResult` interface to match the new response schema
- Remove `parse_extraction_response()` regex-based JSON parsing (structured output handles this)
- Keep `extract_from_communication()` working for backward compatibility during transition, but mark it as deprecated

**Out of scope (handled by other WPs):**
- Batch construction and message formatting — WP-02
- Database persistence of extracted results — handled by WP-04 (dedup/supersede) and WP-06 (pipeline)
- Cron scheduling — WP-06

## Key Files

**Modify:**
- `packages/backend/src/services/ai/extraction.ts` — rewrite prompt, add `extract_from_batch()`, update types
- `packages/backend/src/services/ai/gemini.ts` — add `generate_with_flash_json()` function

**Reference (read, don't modify):**
- `packages/backend/src/config.ts` — config values (confidence threshold)
- `packages/shared/src/types/fact.ts` — fact types (after WP-01 updates)

## Technical Details

### New Gemini JSON Mode Function

Add to `gemini.ts`:

```typescript
// Function signature for structured JSON output
async function generate_with_flash_json<T>(
  prompt: string,
  response_schema: object
): Promise<T>
```

This should use the Google Generative AI SDK's structured output:
```typescript
const model = get_gen_ai().getGenerativeModel({
  model: process.env.GEMINI_FLASH_MODEL || 'gemini-2.0-flash',
  generationConfig: {
    responseMimeType: 'application/json',
    responseSchema: response_schema,
  },
});
```

Note the default model changes from `gemini-2.5-flash` to `gemini-2.0-flash` per the spec's `GEMINI_FLASH_MODEL` default. Update both `get_flash_model()` and the new JSON function to use `gemini-2.0-flash` as default.

### Extraction Response Schema (for Gemini structured output)

```typescript
const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    facts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          fact_type: {
            type: 'string',
            enum: ['birthday', 'location', 'job_title', 'company', 'email', 'phone',
                   'preference', 'tool', 'hobby', 'opinion', 'life_event', 'goal', 'custom'],
          },
          value: { type: 'string' },
          structured_value: {
            type: 'object',
            nullable: true,
          },
          confidence: { type: 'number' },
        },
        required: ['fact_type', 'value', 'confidence'],
      },
    },
    relationships: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          person_name: { type: 'string' },
          confidence: { type: 'number' },
        },
        required: ['label', 'person_name', 'confidence'],
      },
    },
    followups: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          reason: { type: 'string' },
          suggested_date: { type: 'string' },
        },
        required: ['reason', 'suggested_date'],
      },
    },
  },
  required: ['facts', 'relationships', 'followups'],
};
```

### New extract_from_batch Function

```typescript
async function extract_from_batch(
  formatted_prompt: string,   // pre-formatted by batching service
  contact_name: string,
): Promise<ExtractionResult>
```

This replaces `extract_from_text()` for the new pipeline. The `formatted_prompt` is the complete formatted batch string with context and new messages, already prepared by the batching module.

### Prompt Quality Mandate

The prompt must include:
- Explicit instruction to only extract meaningful personal details
- Good examples: "prefers olive oil over butter", "switched from Replit to Claude Code", "works at Meta (previously Google)", "training for a marathon", "wants to learn Rust", "has a daughter named Emma"
- Bad examples: "went to the store", "is running late", "had lunch", "said they're busy", "asked about the weather"
- Statement that returning empty arrays is correct and expected
- Instruction to use free-form relationship labels (suggest common ones but allow any)
- Source-type awareness note
- Clear context vs extractable message differentiation

### Updated ExtractionResult Interface

The `ExtractionResult` interface stays the same shape but types are updated:
```typescript
interface ExtractedFact {
  fact_type: string;  // now accepts all 13 types
  value: string;
  structured_value?: Record<string, unknown> | null;
  confidence: number;
}

interface ExtractedRelationship {
  label: string;     // free-form, not enum-constrained
  person_name: string;
  confidence: number;
}

interface ExtractedFollowup {
  reason: string;
  suggested_date: string;
}
```

## Acceptance Criteria

- [ ] New `generate_with_flash_json()` function added to `gemini.ts` with structured output support
- [ ] Default model updated to `gemini-2.0-flash` in both `get_flash_model()` and JSON function
- [ ] New `extract_from_batch()` function accepts pre-formatted batch string
- [ ] Prompt includes quality mandate with good/bad examples
- [ ] Prompt supports all 13 fact types
- [ ] Prompt uses free-form relationship labels
- [ ] Prompt clearly differentiates context vs extractable messages
- [ ] Structured output schema enforces correct response shape
- [ ] Old `extract_from_text()` and `extract_from_communication()` still work (backward compat)
- [ ] No regex-based JSON parsing for the new code path
- [ ] All new code has test coverage
- [ ] No regressions in existing tests

## Verification Commands

```bash
# Run unit tests
cd packages/backend && npx vitest run

# Type check
cd packages/backend && npx tsc --noEmit

# Lint
cd packages/backend && npx eslint src/services/ai/extraction.ts src/services/ai/gemini.ts
```
