from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app import models, schemas
from app.core.config import get_settings
from app.core.database import get_db, init_db
from app.services.analysis import (
    analysis_payload,
    build_sample_ai_evidence_input_for_project,
    ensure_default_sdrf_table,
    get_blueprint,
    import_pride_metadata,
    replace_blueprint,
    run_analysis,
)
from app.services.ai_client import proxy_chat_completion
from app.services.sdrf import classify_columns, evidence_report, normalize_sdrf_table, parse_file, table_to_tsv, validate_table, write_xlsx
from app.services.storage import is_sdrf_upload_name, save_upload


settings = get_settings()
app = FastAPI(title="SDRF Studio API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    init_db()


def get_project_or_404(db: Session, project_id: str) -> models.Project:
    project = db.get(models.Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/projects", response_model=schemas.ProjectOut)
def create_project(payload: schemas.ProjectCreate, db: Session = Depends(get_db)) -> models.Project:
    project = models.Project(name=payload.name, description=payload.description)
    db.add(project)
    db.flush()
    ensure_default_sdrf_table(db, project.id)
    db.commit()
    db.refresh(project)
    return project


@app.get("/api/projects", response_model=list[schemas.ProjectOut])
def list_projects(db: Session = Depends(get_db)) -> list[models.Project]:
    return db.query(models.Project).order_by(models.Project.created_at.desc()).all()


@app.get("/api/projects/{project_id}", response_model=schemas.ProjectOut)
def get_project(project_id: str, db: Session = Depends(get_db)) -> models.Project:
    return get_project_or_404(db, project_id)


@app.delete("/api/projects/{project_id}")
def delete_project(project_id: str, db: Session = Depends(get_db)) -> dict[str, str]:
    project = get_project_or_404(db, project_id)
    delete_project_storage(project_id)
    for model in (
        models.JobRecord,
        models.ExportRecord,
        models.ValidationResult,
        models.MappingEdge,
        models.BlueprintNode,
        models.SdrfTable,
        models.AssistantQuestion,
        models.AnalysisEvidence,
        models.UploadedFile,
    ):
        db.query(model).filter(model.project_id == project_id).delete(synchronize_session=False)
    db.delete(project)
    db.commit()
    return {"status": "deleted"}


def delete_project_storage(project_id: str) -> None:
    storage_root = settings.storage_dir.resolve()
    project_dir = (storage_root / Path(project_id).name).resolve()
    if not project_dir.exists():
        return
    if storage_root != project_dir and storage_root in project_dir.parents:
        shutil.rmtree(project_dir)


@app.post("/api/projects/{project_id}/debug/sample-ai-prompts")
def save_sample_ai_prompt(project_id: str, payload: dict[str, Any], db: Session = Depends(get_db)) -> dict[str, str]:
    get_project_or_404(db, project_id)
    now = datetime.now(timezone.utc)
    debug_dir = settings.storage_dir / Path(project_id).name / "debug" / "sample-ai-prompts"
    debug_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{now.strftime('%Y%m%dT%H%M%S%fZ')}.json"
    path = debug_dir / filename
    record = {
        "project_id": project_id,
        "created_at": now.isoformat(),
        "request_body": redact_debug_payload(payload),
    }
    path.write_text(json.dumps(record, indent=2, ensure_ascii=False), encoding="utf-8")
    return {"status": "saved", "filename": filename, "path": str(path.resolve())}


def redact_debug_payload(value: Any) -> Any:
    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for key, item in value.items():
            normalized_key = key.lower().replace("-", "_")
            if normalized_key in {"api_key", "apikey", "x_api_key"}:
                continue
            if normalized_key == "authorization":
                redacted[key] = "[redacted]"
                continue
            redacted[key] = redact_debug_payload(item)
        return redacted
    if isinstance(value, list):
        return [redact_debug_payload(item) for item in value]
    return value


@app.post("/api/projects/{project_id}/imports/pride")
def import_pride(project_id: str, payload: schemas.PrideImportRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    project = get_project_or_404(db, project_id)
    return import_pride_metadata(db, project, payload.accession)


@app.post("/api/projects/{project_id}/files", response_model=schemas.UploadedFileOut)
async def upload_file(
    project_id: str,
    file: UploadFile = File(...),
    file_type: str | None = Form(default=None),
    db: Session = Depends(get_db),
) -> models.UploadedFile:
    get_project_or_404(db, project_id)
    saved = await save_upload(project_id, file)
    if file_type in {"design-table", "publication-pdf", "metadata", "supplementary"}:
        saved["file_type"] = file_type
    if is_sdrf_upload_name(str(saved["filename"])):
        saved["file_type"] = "supplementary"
    uploaded = models.UploadedFile(project_id=project_id, **saved)
    db.add(uploaded)
    db.flush()

    if is_sdrf_upload_name(uploaded.filename):
        uploaded.parse_status = "ignored"
        uploaded.parsed_payload = {"reason": "Existing SDRF files are not used as SDRF Studio inputs."}
    elif uploaded.file_type == "design-table":
        try:
            parsed = parse_file(Path(uploaded.path))
            uploaded.parsed_payload = parsed
            uploaded.parse_status = "parsed"
        except Exception as exc:
            uploaded.parse_status = "error"
            uploaded.parsed_payload = {"error": str(exc)}

    db.commit()
    db.refresh(uploaded)
    return uploaded


@app.delete("/api/projects/{project_id}/files/{file_id}")
def delete_uploaded_file(project_id: str, file_id: str, db: Session = Depends(get_db)) -> dict[str, str]:
    get_project_or_404(db, project_id)
    uploaded = db.get(models.UploadedFile, file_id)
    if not uploaded or uploaded.project_id != project_id:
        raise HTTPException(status_code=404, detail="File not found")
    path = Path(uploaded.path)
    if path.exists() and path.is_file():
        path.unlink()
    db.delete(uploaded)
    db.commit()
    return {"status": "deleted"}


@app.get("/api/projects/{project_id}/files", response_model=list[schemas.UploadedFileOut])
def list_files(project_id: str, db: Session = Depends(get_db)) -> list[models.UploadedFile]:
    get_project_or_404(db, project_id)
    return db.query(models.UploadedFile).filter(models.UploadedFile.project_id == project_id).all()


@app.get("/api/projects/{project_id}/files/{file_id}/preview")
def preview_uploaded_file(project_id: str, file_id: str, db: Session = Depends(get_db)) -> FileResponse:
    get_project_or_404(db, project_id)
    uploaded = db.get(models.UploadedFile, file_id)
    if not uploaded or uploaded.project_id != project_id:
        raise HTTPException(status_code=404, detail="File not found")
    path = Path(uploaded.path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Stored file not found")
    media_type = "application/pdf" if uploaded.file_type == "publication-pdf" else uploaded.content_type
    return FileResponse(path, media_type=media_type, filename=uploaded.filename)


@app.post("/api/projects/{project_id}/analysis/run", response_model=schemas.AnalysisOut)
def run_project_analysis(project_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    project = get_project_or_404(db, project_id)
    return run_analysis(db, project)


@app.post("/api/projects/{project_id}/ai/sample-design-input")
def build_sample_design_ai_input(project_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    project = get_project_or_404(db, project_id)
    payload = build_sample_ai_evidence_input_for_project(db, project)
    db.commit()
    return payload


@app.post("/api/ai/chat")
def proxy_ai_chat(payload: dict[str, Any]) -> dict[str, Any]:
    return proxy_chat_completion(payload)


@app.get("/api/projects/{project_id}/analysis", response_model=schemas.AnalysisOut)
def get_project_analysis(project_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    get_project_or_404(db, project_id)
    return analysis_payload(db, project_id)


@app.get("/api/projects/{project_id}/blueprint", response_model=schemas.BlueprintPayload)
def get_project_blueprint(project_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    get_project_or_404(db, project_id)
    return get_blueprint(db, project_id)


@app.put("/api/projects/{project_id}/blueprint", response_model=schemas.BlueprintPayload)
def put_project_blueprint(project_id: str, payload: schemas.BlueprintPayload, db: Session = Depends(get_db)) -> dict[str, Any]:
    get_project_or_404(db, project_id)
    return replace_blueprint(db, project_id, payload.model_dump())


@app.get("/api/projects/{project_id}/sdrf/table", response_model=schemas.SdrfTableOut)
def get_sdrf_table(project_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    get_project_or_404(db, project_id)
    table = ensure_default_sdrf_table(db, project_id)
    headers, rows = normalize_sdrf_table(table.headers, table.rows)
    if headers != table.headers or rows != table.rows:
        table.headers = headers
        table.rows = rows
        table.column_metadata = classify_columns(headers)
        db.commit()
    return {
        "id": table.id,
        "project_id": table.project_id,
        "headers": headers,
        "rows": rows,
        "column_metadata": table.column_metadata,
        "dirty": table.dirty,
        "validation_state": table.validation_state,
    }


@app.put("/api/projects/{project_id}/sdrf/table", response_model=schemas.SdrfTableOut)
def put_sdrf_table(project_id: str, payload: schemas.SdrfTablePayload, db: Session = Depends(get_db)) -> dict[str, Any]:
    get_project_or_404(db, project_id)
    table = ensure_default_sdrf_table(db, project_id)
    headers, rows = normalize_sdrf_table(payload.headers, payload.rows)
    table.headers = headers
    table.rows = rows
    table.column_metadata = classify_columns(headers)
    table.dirty = payload.dirty
    table.validation_state = payload.validation_state
    db.commit()
    return get_sdrf_table(project_id, db)


@app.post("/api/projects/{project_id}/validate", response_model=schemas.ValidationOut)
def validate_project(project_id: str, db: Session = Depends(get_db)) -> models.ValidationResult:
    get_project_or_404(db, project_id)
    table = ensure_default_sdrf_table(db, project_id)
    headers, rows = normalize_sdrf_table(table.headers, table.rows)
    table.headers = headers
    table.rows = rows
    table.column_metadata = classify_columns(headers)
    issues, summary = validate_table(headers, rows)
    status = "passed" if summary["errors"] == 0 else "failed"
    result = models.ValidationResult(project_id=project_id, status=status, issues=issues, summary=summary)
    table.validation_state = {"status": status, "summary": summary, "issues": issues}
    db.add(result)
    db.commit()
    db.refresh(result)
    return result


@app.post("/api/projects/{project_id}/export", response_model=list[schemas.ExportOut])
def export_project(project_id: str, db: Session = Depends(get_db)) -> list[models.ExportRecord]:
    project = get_project_or_404(db, project_id)
    table = ensure_default_sdrf_table(db, project_id)
    headers, rows = normalize_sdrf_table(table.headers, table.rows)
    table.headers = headers
    table.rows = rows
    table.column_metadata = classify_columns(headers)
    export_dir = settings.storage_dir / project_id / "exports"
    export_dir.mkdir(parents=True, exist_ok=True)

    stem = project.name.lower().replace(" ", "-") or "sdrf-project"
    tsv_path = export_dir / f"{stem}.sdrf.tsv"
    xlsx_path = export_dir / f"{stem}.sdrf.xlsx"
    evidence_path = export_dir / f"{stem}.evidence.json"
    validation_path = export_dir / f"{stem}.validation.json"

    tsv_path.write_text(table_to_tsv(headers, rows), encoding="utf-8")
    try:
        write_xlsx(xlsx_path, headers, rows)
    except Exception:
        xlsx_path = None

    evidences = db.query(models.AnalysisEvidence).filter(models.AnalysisEvidence.project_id == project_id).all()
    questions = db.query(models.AssistantQuestion).filter(models.AssistantQuestion.project_id == project_id).all()
    evidence_path.write_text(evidence_report(evidences, questions), encoding="utf-8")

    issues, summary = validate_table(headers, rows)
    validation_path.write_text(json.dumps({"issues": issues, "summary": summary}, indent=2), encoding="utf-8")

    records = [
        models.ExportRecord(project_id=project_id, export_type="sdrf-tsv", path=str(tsv_path), payload={"download": f"/api/exports/{project_id}/{tsv_path.name}"}),
        models.ExportRecord(project_id=project_id, export_type="evidence-json", path=str(evidence_path), payload={"download": f"/api/exports/{project_id}/{evidence_path.name}"}),
        models.ExportRecord(project_id=project_id, export_type="validation-json", path=str(validation_path), payload={"download": f"/api/exports/{project_id}/{validation_path.name}"}),
    ]
    if xlsx_path is not None:
        records.append(models.ExportRecord(project_id=project_id, export_type="sdrf-xlsx", path=str(xlsx_path), payload={"download": f"/api/exports/{project_id}/{xlsx_path.name}"}))
    db.add_all(records)
    db.commit()
    return records


@app.get("/api/exports/{project_id}/{filename}")
def download_export(project_id: str, filename: str, db: Session = Depends(get_db)) -> FileResponse:
    get_project_or_404(db, project_id)
    path = settings.storage_dir / project_id / "exports" / Path(filename).name
    if not path.exists():
        raise HTTPException(status_code=404, detail="Export not found")
    return FileResponse(path)


@app.get("/api/imports/{project_id}/{filename}")
def download_import(project_id: str, filename: str, db: Session = Depends(get_db)) -> FileResponse:
    get_project_or_404(db, project_id)
    path = settings.storage_dir / project_id / "imports" / Path(filename).name
    if not path.exists():
        raise HTTPException(status_code=404, detail="Imported file not found")
    media_type = "application/pdf" if path.suffix.lower() == ".pdf" else "text/tab-separated-values"
    return FileResponse(path, media_type=media_type, filename=path.name)


@app.get("/api/jobs/{job_id}", response_model=schemas.JobOut)
def get_job(job_id: str, db: Session = Depends(get_db)) -> models.JobRecord:
    job = db.get(models.JobRecord, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job
