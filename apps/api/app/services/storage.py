from __future__ import annotations

import hashlib
from pathlib import Path

from fastapi import UploadFile

from app.core.config import get_settings


def is_sdrf_upload_name(filename: str) -> bool:
    lower = filename.lower()
    return lower == "sdrf.tsv" or lower.endswith(".sdrf.tsv") or lower.endswith(".sdrf") or ("sdrf" in lower and lower.endswith(".tsv"))


def classify_file(filename: str, content_type: str = "") -> str:
    if is_sdrf_upload_name(filename):
        return "supplementary"
    suffix = Path(filename).suffix.lower()
    if suffix in {".tsv", ".csv", ".xlsx", ".xlsm", ".xls", ".xlx"}:
        return "design-table"
    if suffix == ".pdf":
        return "publication-pdf"
    if suffix == ".txt":
        return "metadata"
    if suffix in {".raw", ".mzml", ".d", ".wiff", ".wiff2"}:
        return "data-file-name"
    if content_type.startswith("text/"):
        return "metadata"
    return "supplementary"


async def save_upload(project_id: str, upload: UploadFile) -> dict[str, object]:
    settings = get_settings()
    project_dir = settings.storage_dir / project_id / "uploads"
    project_dir.mkdir(parents=True, exist_ok=True)
    safe_name = Path(upload.filename or "uploaded-file").name
    target = project_dir / safe_name

    hasher = hashlib.sha256()
    size = 0
    with target.open("wb") as handle:
        while chunk := await upload.read(1024 * 1024):
            hasher.update(chunk)
            size += len(chunk)
            handle.write(chunk)

    return {
        "filename": safe_name,
        "content_type": upload.content_type or "application/octet-stream",
        "file_type": classify_file(safe_name, upload.content_type or ""),
        "path": str(target),
        "sha256": hasher.hexdigest(),
        "size_bytes": size,
    }
