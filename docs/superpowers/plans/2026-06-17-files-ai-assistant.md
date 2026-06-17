# Files AI Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Files page Ai Assistant that generates editable data-file technical attribute drafts before the user saves them into SDRF.

**Architecture:** Extend `FilesStep` in `apps/web/src/App.tsx` with a Files-specific AI input builder, request payload builder, response parser, and assistant panel. Keep persistence behind the existing `Save technical configuration` mutation so AI never writes the SDRF table directly.

**Tech Stack:** React, TanStack Query mutations, Vitest, Testing Library, existing OpenAI-compatible chat-completions client configuration.

---

### Task 1: Files AI Integration Test

**Files:**
- Modify: `apps/web/src/App.test.tsx`

- [ ] **Step 1: Write the failing test**

Add a test in `describe("FilesStep technical configuration", ...)` named `fills data-file technical attributes from the Files AI assistant`. The test should mock `api.saveSampleAiPrompt`, `api.putSdrfTable`, and global `fetch`, render `renderAppAtStep("files", ...)`, click the Files assistant `Run AI` button, assert the AI-filled form values are visible, then click `Save technical configuration` and assert the saved SDRF row contains the AI values.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd run test -- App.test.tsx -t "fills data-file technical attributes from the Files AI assistant"`

Expected: FAIL because the Files page does not yet expose a Files AI assistant.

### Task 2: Files AI Request and Parsing

**Files:**
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Add Files AI types and builders**

Add `FilesTechnicalAiInput`, `FilesTechnicalAiDraft`, `buildFilesTechnicalAiInput`, and `buildFilesTechnicalAiRequestPayload`. The input must include the current SDRF table preview, uploaded files, current technical state, current draft mappings, and the output schema. The request payload must use `response_format: { type: "json_object" }` and must not include the API key.

- [ ] **Step 2: Add response sanitizer**

Add `parseFilesTechnicalAiDraft` and helpers that normalize aliases such as `label_type`, `fraction_ids`, and `file_mappings`, sanitize strings with `cleanOneLineString`, and cap lists to reasonable UI sizes.

- [ ] **Step 3: Add provider call**

Add `requestFilesTechnicalDraft(input, config, requestPayload)` that posts to `config.baseUrl`, handles non-OK responses with `formatAiResponseError`, parses the provider response using `parseAiJsonObject`, and returns a sanitized draft.

### Task 3: Files Page UI Wiring

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Add Files AI state and mutation**

Inside `FilesStep`, add AI status/error/result state and a `useMutation` that reads client config, saves the prompt with `api.saveSampleAiPrompt`, then calls `requestFilesTechnicalDraft`.

- [ ] **Step 2: Apply AI draft to editable form state**

On success, update label type, labels, fractions, acquisition method, instrument, cleavage agent, and file mapping drafts. Do not call `api.putSdrfTable`.

- [ ] **Step 3: Render assistant rail**

Render `AssistantPanel` beside the Files editor and add a compact `FilesTechnicalAssistant` child component with a run button, status/error text, summary, warnings, and preview of generated mappings.

- [ ] **Step 4: Add compact styles**

Add small CSS rules for the Files AI assistant preview list and warning chips if existing assistant styles do not cover them.

### Task 4: Verification

**Files:**
- Verify only

- [ ] **Step 1: Run targeted Files AI test**

Run: `npm.cmd run test -- App.test.tsx -t "fills data-file technical attributes from the Files AI assistant"`

Expected: PASS.

- [ ] **Step 2: Run affected workflow tests**

Run: `npm.cmd run test -- App.test.tsx -t "places Files after Blueprint|saves MS-proteomics technical fields|sends a summarized SDRF completeness review|fills data-file technical attributes"`

Expected: PASS.

- [ ] **Step 3: Run production build**

Run: `npm.cmd run build`

Expected: TypeScript and Vite build complete with exit code 0.
