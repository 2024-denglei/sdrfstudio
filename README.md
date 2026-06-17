# SDRF Studio

SDRF Studio is an intranet-first application for building, reviewing, validating, and exporting proteomics SDRF files. It follows the SDRF-Proteomics v1.1.0 model: tab-delimited rows linking samples to data files, with `characteristics[...]`, `comment[...]`, and `factor value[...]` columns.

## Stack

- `apps/web`: React, TypeScript, Vite, Tailwind, TanStack Query/Table, React Flow, Zustand, lucide-react
- `apps/api`: FastAPI, SQLAlchemy, PostgreSQL, Redis/RQ-ready background jobs
- `docker-compose.yml`: web, api, PostgreSQL, Redis, persistent storage volume

## Quick Start

```bash
cp .env.example .env
docker compose up --build
```

Open `http://localhost:5173`.

For local API development:

```bash
cd apps/api
python -m venv .venv
.venv\Scripts\activate
pip install -e ".[dev]"
uvicorn app.main:app --reload
```

For local web development:

```bash
cd apps/web
npm install
npm run dev
```

## Current Scope

The first implementation includes the full 10-step workflow shell, project persistence, file upload, PRIDE metadata import, metadata/design/PDF text extraction, filename pattern detection, blueprint generation, SDRF table editing APIs, local structural validation with optional `sdrf-pipelines` command integration, and export endpoints.

RAW/mzML spectral analysis is intentionally out of scope for v1.
