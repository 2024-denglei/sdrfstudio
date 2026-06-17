# Files Technical Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real MS-proteomics Files technical configuration page, remove Assays/Ontology from the top-level workflow, and turn AI Review into an AI-backed completeness review.

**Architecture:** Keep the change frontend-only. Add focused pure helpers for technical configuration and AI review prompt construction, wire them into `App.tsx`, and leave existing API routes intact by reusing `saveSampleAiPrompt` for prompt debugging.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, TanStack Query, existing class-based CSS.

---

### Task 1: Workflow Shape

- [ ] Write a test that expects workflow keys to exclude `assays` and `ontology`.
- [ ] Update `StepKey`, `steps`, page titles, and step coercion behavior.
- [ ] Run the workflow test.

### Task 2: Files Technical Configuration

- [ ] Write a test that renders the Files step, selects a TMT strategy, fills instrument/acquisition/fraction fields, saves, and verifies `api.putSdrfTable` receives the required MS-proteomics columns.
- [ ] Implement a `FilesStep` component and pure technical-row merge helper.
- [ ] Add CSS for card choices, compact controls, and file mapping table.
- [ ] Run the Files test.

### Task 3: AI Review

- [ ] Write a test that renders AI Review, clicks the review action, verifies prompt saving happens before provider fetch, and verifies the prompt contains table/files/missing-field summaries.
- [ ] Implement AI review prompt construction and `AiReviewStep`.
- [ ] Display returned advice cards and provider errors.
- [ ] Run the AI Review test.

### Task 4: Verification

- [ ] Run targeted frontend tests for workflow, Files, and AI Review.
- [ ] Run frontend build.
- [ ] Report any environment-specific failures separately from application failures.
