# Samples AI Raw File ID Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce Samples AI output size by having the model reference raw files by stable IDs while the app expands IDs back into full SDRF mapping rows.

**Architecture:** The frontend will build a `raw_file_catalog` from imported raw file names using IDs such as `RF001`. Compact Samples AI prompts will ask the model to return `mapping_groups` with `raw_file_ids` rather than full raw filenames. After parsing the AI response, deterministic frontend code expands `mapping_groups` into `mapping_rows`, adds coverage warnings for missing/duplicate/unknown IDs, and preserves existing `mapping_rows` support.

**Tech Stack:** React/Vite/TypeScript, Vitest, existing `apps/web/src/App.tsx` Samples AI flow.

---

### Task 1: Add Tests

**Files:**
- Modify: `apps/web/src/App.test.tsx`

- [x] Add a test that verifies compact Samples AI prompt input includes `raw_file_catalog` with `RF001` IDs and instructs the model to output `mapping_groups`.
- [x] Add a test that verifies AI `mapping_groups.raw_file_ids` are expanded into `mapping_rows` with original `data_file` values.
- [x] Add a test that verifies missing, duplicate, and unknown raw file IDs produce coverage warnings.

### Task 2: Implement Raw File Catalog

**Files:**
- Modify: `apps/web/src/App.tsx`

- [x] Add `buildRawFileCatalog(rawFileNames)` to assign stable IDs.
- [x] Include `raw_file_catalog` in compact Samples AI input.
- [x] Update compact output contract to request `mapping_groups` and `raw_file_ids`, not full raw filenames in model output.

### Task 3: Expand Mapping Groups

**Files:**
- Modify: `apps/web/src/App.tsx`

- [x] Add `expandRawFileIdMappingGroups(parsed, input)` to convert AI `mapping_groups` into `mapping_rows`.
- [x] Preserve model-provided fields such as `source_name`, `sample_group`, `label`, `preparation`, `fraction_id`, `acquisition_method`, `technical_replicate`, `assay_name`, and `warnings`.
- [x] Add coverage warnings to `coverage_check` for missing IDs, duplicate IDs, and unknown IDs.
- [x] Keep existing `mapping_rows` behavior for models that still return full rows.

### Task 4: Verify

**Files:**
- Test: `apps/web/src/App.test.tsx`

- [x] Run `npm --prefix apps/web run test -- App.test.tsx -t "raw file IDs"`.
- [x] Run `npm --prefix apps/web run test`.
- [x] Run `npm run web:build`.
