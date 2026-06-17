from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from app.services.sdrf import parse_file

try:
    from pypdf import PdfReader
except Exception:  # pragma: no cover - optional in minimal installs
    PdfReader = None


FILE_PATTERN = re.compile(
    r"(?P<group>CTRL|CONTROL|DIS|DISEASE|TREAT|CASE)?[_-]?"
    r"(?P<sample>S\d+|SAMPLE\d+|[A-Z]+_\d+)?[_-]?"
    r"(?P<replicate>R\d+|REP\d+)?[_-]?"
    r"(?P<fraction>F\d+|FRAC\d+)?",
    re.IGNORECASE,
)


def extract_pdf_pages(path: Path, max_pages: int = 120) -> list[str]:
    if PdfReader is None:
        return []
    reader = PdfReader(str(path))
    pages: list[str] = []
    for page in reader.pages[:max_pages]:
        pages.append(page.extract_text() or "")
    return pages


def extract_pdf_text(path: Path, max_pages: int = 30) -> str:
    pages = extract_pdf_pages(path, max_pages=max_pages)
    return "\n".join(pages).strip()


def extract_metadata_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")[:100_000]


def parse_design_file(path: Path) -> dict[str, Any]:
    table = parse_file(path)
    return {
        "headers": table["headers"],
        "row_count": len(table["rows"]),
        "preview": table["rows"][:20],
    }


def detect_file_patterns(names: list[str]) -> list[dict[str, Any]]:
    patterns = []
    for name in names:
        stem = Path(name).stem
        match = FILE_PATTERN.search(stem)
        payload = {key: value for key, value in (match.groupdict() if match else {}).items() if value}
        patterns.append({
            "filename": name,
            "group": normalize_group(payload.get("group", "")),
            "sample": payload.get("sample") or stem,
            "replicate": payload.get("replicate", ""),
            "fraction": payload.get("fraction", ""),
            "confidence": 0.75 if payload else 0.35,
        })
    return patterns


def normalize_group(value: str) -> str:
    upper = value.upper()
    if upper in {"CTRL", "CONTROL"}:
        return "Control"
    if upper in {"DIS", "DISEASE", "CASE"}:
        return "Disease"
    if upper == "TREAT":
        return "Treatment"
    return value
