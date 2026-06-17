# Agent Notes for SDRF Studio

## First Read

For this local workspace, read `docs/PROJECT_RUNBOOK.zh-CN.md` before starting services. It records the verified Windows/Codex startup commands, local port checks, log paths, and the important distinction between local SQLite startup and Docker `.env` PostgreSQL startup.

## Project Overview

SDRF Studio is an intranet-first application for creating, reviewing, validating, and exporting proteomics SDRF files. The product follows the SDRF-Proteomics v1.1.0 model, where tab-delimited rows connect samples to data files through `characteristics[...]`, `comment[...]`, and `factor value[...]` columns.

The app is a small monorepo:

- `apps/web`: React 18, TypeScript, Vite, Tailwind CSS, TanStack Query/Table, React Flow, Zustand, lucide-react.
- `apps/api`: FastAPI, SQLAlchemy, Pydantic settings, SQLite by default, PostgreSQL in Docker, Redis/RQ-ready background-job dependencies.
- `docker-compose.yml`: runs web, API, PostgreSQL, Redis, and persistent storage.

## Local Commands

From the repository root:

```bash
npm run web:dev
npm run web:build
npm run api:dev
npm run test:api
```

For frontend-only work:

```bash
cd apps/web
npm install
npm run dev
npm run build
npm run test
```

For backend-only work:

```bash
cd apps/api
python -m venv .venv
.venv\Scripts\activate
pip install -e ".[dev]"
uvicorn app.main:app --reload
pytest
```

Docker path:

```bash
cp .env.example .env
docker compose up --build
```

Frontend defaults to `http://localhost:5173`; API defaults to `http://localhost:8000`.

## Architecture Boundaries

- Keep frontend API calls centralized in `apps/web/src/api.ts`.
- Keep workflow state in `apps/web/src/store.ts` and workflow step definitions in `apps/web/src/workflow.ts`.
- `apps/web/src/App.tsx` currently contains much of the user workflow. Prefer extracting focused components only when a change makes the existing file materially harder to maintain.
- Backend route definitions live in `apps/api/app/main.py`.
- SQLAlchemy models live in `apps/api/app/models.py`; response/request schemas live in `apps/api/app/schemas.py`.
- SDRF parsing, validation, and export helpers live in `apps/api/app/services/sdrf.py`.
- PRIDE import, evidence generation, default table creation, and blueprint generation live in `apps/api/app/services/analysis.py`.
- Uploaded-file persistence lives in `apps/api/app/services/storage.py`.

## Data and Storage Notes

- The default local database is `sdrf_studio.db` in the repo root. Treat it as local runtime state, not source.
- Runtime uploads and generated exports live under `storage/`. Treat this as local runtime state.
- Docker uses PostgreSQL and named volumes; local non-Docker API development uses SQLite unless `DATABASE_URL` is set.
- `init_db()` creates tables directly from SQLAlchemy metadata. There is an initial SQL migration file, but there is no active migration runner wired into the app.
- Do not delete local database or storage data unless the user explicitly asks.

## Backend Guidance

- Maintain FastAPI + SQLAlchemy patterns already in place: dependency-injected `Session`, route-local validation through helper functions, and service modules for domain logic.
- Preserve the API shape expected by `apps/web/src/api.ts` and `apps/web/src/types.ts`.
- Network calls to PRIDE, Europe PMC, and publication PDFs are intentionally timeout-bounded. Keep that behavior when changing import logic.
- SDRF validation first tries the optional `sdrf` CLI from `sdrf-pipelines`; when unavailable it falls back to local structural validation. Do not make the external CLI mandatory.
- Keep file path handling constrained through `Path(filename).name` or existing safe filename helpers when serving imports/exports.
- Add or update tests in `apps/api/tests` for route behavior, parsing, validation, import normalization, and export changes.

## Frontend Guidance

- Use the existing class-based styling in `apps/web/src/styles.css`; do not introduce a second styling system.
- Use lucide-react icons for icon buttons and navigation, matching the current UI.
- Preserve the 10-step workflow keys defined in `apps/web/src/types.ts` and `apps/web/src/workflow.ts` unless the product flow is intentionally changing.
- Use TanStack Query for server state and invalidation. Keep local UI-only choices in component state or the existing Zustand store.
- The UI is an operational data tool. Prefer dense, scannable controls and clear tables over marketing-style layouts.
- Keep API base URL configuration through `VITE_API_BASE_URL`.
- Browser-side AI settings are stored in `localStorage` under `sdrf-studio-ai-config`; do not add hardcoded secrets or new default private keys.

## Testing Expectations

- For backend changes, run `npm run test:api` from the root or `pytest` inside `apps/api`.
- For frontend changes, run `npm run build` and `npm run test` inside `apps/web`, or `npm run web:build` from the root for build-only verification.
- If a change spans API and UI contracts, run both backend tests and frontend tests/build.
- Tests may create rows in the local SQLite database and files under `storage/`; avoid relying on a pristine database unless the test sets up its own state.

## Security and Secrets

- Never commit real API keys, access tokens, private endpoints, or user data.
- Check `.env`, browser AI defaults, and test fixtures carefully before editing or sharing snippets.
- Prefer `.env.example` for documenting configurable values.
- Treat downloaded PRIDE metadata, publication PDFs, uploads, and exports as user/runtime data.

## Code Style

- Keep TypeScript types explicit at API/component boundaries.
- Keep Python service functions small enough to test directly where possible.
- Prefer structured parsing helpers over ad hoc string splitting for SDRF, CSV, TSV, Excel, and PDF-related logic.
- Avoid broad refactors while fixing targeted behavior.
- Preserve existing naming conventions: snake_case in Python/API payloads and camelCase only where already used in TypeScript-local code.

## Useful Files

- `README.md`: high-level setup and current scope.
- `package.json`: root scripts.
- `apps/web/package.json`: frontend scripts and dependencies.
- `apps/api/pyproject.toml`: backend dependencies and pytest configuration.
- `apps/api/tests`: backend regression tests.
- `apps/web/src/App.test.tsx`: frontend workflow tests.
