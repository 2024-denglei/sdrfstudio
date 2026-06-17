# Unified AI Assistant Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align Blueprint and Files AI assistant layout and styling with the Samples assistant rail.

**Architecture:** Keep existing page components inside `apps/web/src/App.tsx`. Reuse `AssistantPanel` focused mode and existing CSS classes rather than introducing a new layout system.

**Tech Stack:** React, Testing Library, Vitest, existing CSS.

---

### Task 1: Layout Tests

**Files:**
- Modify: `apps/web/src/App.test.tsx`

- [ ] **Step 1: Add Blueprint focused assistant layout test**

Render `renderAppAtStep("blueprint", { analysis, table })`, find the page wrapper from the Blueprint heading, and assert it has `templates-content-grid` and `samples-content-grid`. Assert the right rail has `template-assistant-rail`, the panel has `template-assistant-panel`, and the Blueprint AI action is visible.

- [ ] **Step 2: Add Files focused assistant layout test**

Render `renderAppAtStep("files", { table })`, find the page wrapper from the Technical Configuration heading, and assert it has `templates-content-grid` and `samples-content-grid`. Assert the right rail has `template-assistant-rail`, the panel has `template-assistant-panel`, and `Run AI` is visible.

- [ ] **Step 3: Run the targeted tests to verify red**

Run: `npm.cmd run test -- App.test.tsx -t "uses the Samples assistant layout"`

Expected: FAIL because Blueprint and Files still use the ordinary `content-grid` wrapper and Blueprint does not use focused assistant mode.

### Task 2: Blueprint Layout

**Files:**
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Change Blueprint wrapper**

Change the Blueprint page wrapper from `content-grid` to `content-grid templates-content-grid samples-content-grid`.

- [ ] **Step 2: Focus Blueprint AssistantPanel**

Set Blueprint `AssistantPanel` to `showQuestions={false}`, `showEvidence={false}`, and `useFallbacks={false}`.

- [ ] **Step 3: Use recommendation structure**

Wrap Blueprint right-rail content in `assistant-recommendation`, `assistant-recommendation-scroll`, and `recommendation-actions compact ai-sample-actions` so it follows the Samples rail layout.

### Task 3: Files Layout

**Files:**
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Change Files wrapper**

Change the Files page wrapper from `content-grid` to `content-grid templates-content-grid samples-content-grid`.

- [ ] **Step 2: Preserve Files AI behavior**

Keep `FilesTechnicalAssistant` behavior unchanged and ensure its action area stays inside `recommendation-actions compact ai-sample-actions`.

### Task 4: Verification

**Files:**
- Verify only

- [ ] **Step 1: Run targeted layout tests**

Run: `npm.cmd run test -- App.test.tsx -t "uses the Samples assistant layout"`

Expected: PASS.

- [ ] **Step 2: Run affected workflow tests**

Run: `npm.cmd run test -- App.test.tsx -t "uses the Samples assistant layout|fills data-file technical attributes|saves MS-proteomics technical fields"`

Expected: PASS.

- [ ] **Step 3: Run TypeScript check**

Run: `npx.cmd tsc --noEmit`

Expected: exit code 0.

- [ ] **Step 4: Run frontend build**

Run: `npm.cmd run build`

Expected: exit code 0.
