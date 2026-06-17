# Review Validation Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the final AI Review, Validation, and Export pages into a review dashboard, explicit sdrf-pipelines validation page, and full SDRF table export preview.

**Architecture:** Keep page code inside `apps/web/src/App.tsx` following the existing single-file page pattern. Add small SDRF summary helper functions near `AiReviewStep`, improve backend validator command discovery in `apps/api/app/services/sdrf.py`, and cover behavior with focused Vitest and pytest tests.

**Tech Stack:** React, TanStack Query mutations, Vitest, Testing Library, FastAPI service tests, pytest.

---

### Task 1: Frontend Page Tests

**Files:**
- Modify: `apps/web/src/App.test.tsx`

- [ ] **Step 1: Write the failing AI Review dashboard test**

Add a test that renders `renderAppAtStep("ai-review", { table })` with a populated SDRF table and expects `Review Your SDRF`, `Configuration Summary`, `Human Samples`, `Homo sapiens`, `Label-free (LFQ)`, `Q Exactive`, and a `Table Preview` row to appear.

- [ ] **Step 2: Write the failing Validation test**

Add a test that mocks `api.validate` to return `summary.validator = "sdrf-pipelines"`, renders `renderAppAtStep("validation", { table })`, clicks `Validate SDRF`, and expects `SDRF Pipeline Validation` plus `sdrf-pipelines`.

- [ ] **Step 3: Write the failing Export test**

Add a test that renders `renderAppAtStep("export", { table })`, expects `Complete SDRF Table`, sees all table values, clicks `Generate exports`, and verifies `api.exportProject` was called.

- [ ] **Step 4: Run tests to verify red**

Run: `npm.cmd run test -- App.test.tsx -t "Review Your SDRF|SDRF Pipeline Validation|Complete SDRF Table"`

Expected: FAIL because the current pages still use the older layouts.

### Task 2: Backend sdrf-pipelines Command Test

**Files:**
- Modify: `apps/api/tests/test_sdrf.py`

- [ ] **Step 1: Write the failing command invocation test**

Add a test that monkeypatches `shutil.which` to return `/usr/bin/sdrf`, monkeypatches `subprocess.run`, calls `validate_table`, and asserts the command starts with `["/usr/bin/sdrf", "validate", "-s"]` and `summary["validator"] == "sdrf-pipelines"`.

- [ ] **Step 2: Run test to verify behavior**

Run: `uv run pytest apps/api/tests/test_sdrf.py -q`

Expected: PASS if existing behavior already invokes `sdrf`; otherwise FAIL and then implement command discovery.

### Task 3: AI Review Dashboard Implementation

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Add SDRF review summary helpers**

Add helpers to derive unique sample count, template label, column count, row count, and configuration summary values from the current SDRF table.

- [ ] **Step 2: Replace top AI Review panel**

Update `AiReviewStep` to render the screenshot-style title, metric cards, configuration summary, table preview, and then the existing AI review action/recommendations.

- [ ] **Step 3: Add dashboard styles**

Add CSS for review title, summary cards, configuration grid, and table preview spacing.

### Task 4: Validation and Export Implementation

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/api/app/services/sdrf.py`

- [ ] **Step 1: Update Validation page**

Change the page title and copy to `SDRF Pipeline Validation`, display validator source, errors, warnings, rows, columns, and issues.

- [ ] **Step 2: Update Export page**

Change `ExportStep` to accept `table`, render a `Complete SDRF Table` panel with `SdrfGrid table={table} showFallback={false}`, and keep export generation links.

- [ ] **Step 3: Pass table into ExportStep**

Update `StepContent` so `export` passes the loaded table into `ExportStep`.

- [ ] **Step 4: Improve backend validator command discovery**

Keep current `sdrf` command support and optionally allow a `sdrf-pipelines` executable name if present. Keep fallback behavior when no command exists.

### Task 5: Verification

**Files:**
- Verify only

- [ ] **Step 1: Run targeted frontend tests**

Run: `npm.cmd run test -- App.test.tsx -t "Review Your SDRF|SDRF Pipeline Validation|Complete SDRF Table"`

Expected: PASS.

- [ ] **Step 2: Run backend SDRF tests**

Run: `uv run pytest apps/api/tests/test_sdrf.py -q`

Expected: PASS.

- [ ] **Step 3: Run TypeScript check**

Run: `npx.cmd tsc --noEmit`

Expected: exit code 0.

- [ ] **Step 4: Run frontend build**

Run: `npm.cmd run build`

Expected: exit code 0.
