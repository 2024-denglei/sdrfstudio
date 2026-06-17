from __future__ import annotations

import re
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import requests
from sqlalchemy.orm import Session

from app import models
from app.core.config import get_settings
from app.services.extractors import detect_file_patterns, extract_metadata_text, extract_pdf_pages, extract_pdf_text, parse_design_file
from app.services.sdrf import default_table


PRIDE_BASE = "https://www.ebi.ac.uk/pride/ws/archive/v2"
EUROPE_PMC_BASE = "https://www.ebi.ac.uk/europepmc/webservices/rest"
PRIDE_PROJECT_URL = "https://www.ebi.ac.uk/pride/ws/archive/v2/projects/{accession}"
PRIDE_FILES_URLS = [
    "https://www.ebi.ac.uk/pride/ws/archive/v2/projects/{accession}/files?pageSize=500",
    "https://www.ebi.ac.uk/pride/ws/archive/v2/projects/{accession}/files",
    "https://www.ebi.ac.uk/pride/ws/archive/v2/files/byProject?projectAccession={accession}&pageSize=200",
    "https://www.ebi.ac.uk/pride/ws/archive/v2/files/byProject?accession={accession}&pageSize=200",
]
PRIDE_PROJECT_TIMEOUT_SECONDS = 10
PRIDE_FILES_TIMEOUT_SECONDS = 12
PRIDE_FILES_MAX_PAGES = 50
EUROPE_PMC_TIMEOUT_SECONDS = 8
PUBLICATION_PDF_TIMEOUT_SECONDS = 12
SAMPLE_EVIDENCE_SCHEMA_VERSION = "sample-evidence-v1"
SAMPLE_AI_EVIDENCE_INPUT_SCHEMA_VERSION = "sample-ai-evidence-input-v1"
PUBLICATION_DOCUMENT_MAX_PAGES = 120
PUBLICATION_DOCUMENT_MAX_CHARS = 180_000
PUBLICATION_DOCUMENT_PAGE_MAX_CHARS = 16_000
SAMPLE_EVIDENCE_PRIORITY = [
    "publication PDF sample evidence",
    "parsed design table or uploaded structured metadata",
    "raw file names for AI-inferred experiment structure",
    "PRIDE project metadata and sampleProcessingProtocol",
    "PRIDE title, description, and keywords",
    "existing SDRF evidence is disabled by default",
]
RAW_LIKE_CATEGORIES = {"RAW", "SWIFF"}
RAW_LIKE_EXTENSIONS = {
    ".raw",
    ".wiff",
    ".wiff2",
    ".wiff.scan",
    ".d",
    ".mzml",
    ".mzxml",
    ".lcd",
    ".baf",
    ".tdf",
    ".tsf",
}
PDF_SAMPLE_KEYWORDS = [
    "cell line",
    "cells",
    "culture",
    "cultured",
    "medium",
    "treated",
    "treatment",
    "stimulated",
    "stimulation",
    "egf",
    "nocodazole",
    "thymidine",
    "mitosis",
    "mitotic",
    "pervanadate",
    "pervandate",
    "calyculin",
    "replicate",
    "quadruplicate",
    "triplicate",
    "biological",
    "time point",
    "timepoint",
    "min",
    "hour",
]


def import_pride_metadata(db: Session, project: models.Project, accession: str) -> dict[str, Any]:
    project.pride_accession = accession.upper()
    payload: dict[str, Any] = {"accession": project.pride_accession}
    project_result = fetch_pride_json(PRIDE_PROJECT_URL.format(accession=project.pride_accession), timeout=PRIDE_PROJECT_TIMEOUT_SECONDS)
    if project_result["ok"]:
        payload["project_raw"] = project_result["data"]
        payload["project"] = normalize_project_details(project_result["data"])
        enrich_publication_access(db, project.id, payload["project"])
        payload["project_source"] = project_result["url"]
    else:
        payload["project_error"] = project_result["error"]
        payload["project_source"] = project_result["url"]

    file_attempts = []
    for url_template in PRIDE_FILES_URLS:
        result = fetch_pride_file_pages(url_template.format(accession=project.pride_accession), timeout=PRIDE_FILES_TIMEOUT_SECONDS)
        file_attempts.append({"url": result["url"], "ok": result["ok"], "error": result.get("error", "")})
        if result["ok"]:
            payload["files"] = normalize_project_files(project.pride_accession, result["data"])
            payload["files_source"] = result["url"]
            break
    else:
        payload["files_error"] = "; ".join(item["error"] for item in file_attempts if item["error"]) or "No file list endpoint returned data."
        payload["files_attempts"] = file_attempts

    db.query(models.AnalysisEvidence).filter(
        models.AnalysisEvidence.project_id == project.id,
        models.AnalysisEvidence.source_type == "pride",
        models.AnalysisEvidence.field == "project accession",
        models.AnalysisEvidence.source_ref == project.pride_accession,
    ).delete(synchronize_session=False)
    add_evidence(db, project.id, "pride", project.pride_accession, "project accession", project.pride_accession, 0.95, payload)
    add_pride_import_sample_evidence(db, project, payload)
    project.current_step = "ai-analysis"
    db.commit()
    return payload


def normalize_project_details(data: dict[str, Any]) -> dict[str, Any]:
    organisms = extract_named_values(data.get("organisms", []))
    instruments = extract_named_values(data.get("instruments", []))
    modifications = extract_named_values(data.get("identifiedPTMStrings", []))
    publications: list[dict[str, Any]] = []
    for reference in data.get("references", []) or []:
        if not isinstance(reference, dict):
            continue
        pmid = reference.get("pubmedID")
        doi = reference.get("doi")
        line = reference.get("referenceLine", "") or ""
        publications.append(resolve_publication(pmid, doi, line))
    return {
        "accession": data.get("accession"),
        "title": data.get("title"),
        "description": data.get("projectDescription"),
        "sample_processing_protocol": data.get("sampleProcessingProtocol"),
        "data_processing_protocol": data.get("dataProcessingProtocol"),
        "organism": organisms,
        "instruments": instruments,
        "modifications": modifications,
        "publications": publications,
        "keywords": data.get("keywords", []),
    }


def extract_named_values(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    names: list[str] = []
    for item in value:
        if isinstance(item, dict):
            name = item.get("name") or item.get("value") or item.get("accession")
        else:
            name = item
        if name:
            names.append(str(name))
    return names


def resolve_publication(pmid: Any, doi: Any, reference: str) -> dict[str, Any]:
    pmid_str = str(pmid).strip() if pmid else ""
    doi_str = str(doi).strip() if doi else ""
    hit = None
    if pmid_str and pmid_str != "0":
        hit = europe_pmc_lookup(f"EXT_ID:{pmid_str}")
    if hit is None and doi_str:
        hit = europe_pmc_lookup(f"DOI:{doi_str}")
    if hit is None:
        doi_url = f"https://doi.org/{doi_str}" if doi_str else None
        pubmed_url = f"https://pubmed.ncbi.nlm.nih.gov/{pmid_str}/" if pmid_str and pmid_str != "0" else None
        return {
            "pmid": pmid_str or None,
            "pmcid": None,
            "doi": doi_str or None,
            "is_open_access": False,
            "reference": reference,
            "doi_url": doi_url,
            "pubmed_url": pubmed_url,
            "article_url": doi_url or pubmed_url,
            "access_status": "not_resolved",
        }
    doi_value = hit.get("doi") or doi_str or None
    pmid_value = hit.get("pmid") or pmid_str or None
    doi_url = f"https://doi.org/{doi_value}" if doi_value else None
    pubmed_url = f"https://pubmed.ncbi.nlm.nih.gov/{pmid_value}/" if pmid_value else None
    return {
        "pmid": pmid_value,
        "pmcid": hit.get("pmcid"),
        "doi": doi_value,
        "is_open_access": hit.get("isOpenAccess") == "Y",
        "reference": reference,
        "title": hit.get("title"),
        "journal": hit.get("journalTitle"),
        "year": hit.get("pubYear"),
        "abstract": hit.get("abstractText", "") or "",
        "doi_url": doi_url,
        "pubmed_url": pubmed_url,
        "article_url": doi_url or pubmed_url,
        "pdf_url": extract_pdf_url(hit),
        "access_status": "open_access" if hit.get("isOpenAccess") == "Y" else "publisher_access",
    }


def europe_pmc_lookup(query: str) -> dict[str, Any] | None:
    try:
        response = requests.get(
            f"{EUROPE_PMC_BASE}/search",
            params={"query": query, "format": "json", "pageSize": 1, "resultType": "core"},
            timeout=EUROPE_PMC_TIMEOUT_SECONDS,
            headers={"Accept": "application/json"},
        )
        response.raise_for_status()
        hits = response.json().get("resultList", {}).get("result", [])
        return hits[0] if hits else None
    except Exception:
        return None


def extract_pdf_url(hit: dict[str, Any]) -> str | None:
    full_text_url_list = hit.get("fullTextUrlList", {})
    if isinstance(full_text_url_list, dict):
        urls = full_text_url_list.get("fullTextUrl", [])
    else:
        urls = []
    if isinstance(urls, dict):
        urls = [urls]
    if not isinstance(urls, list):
        return None
    for item in urls:
        if not isinstance(item, dict):
            continue
        if str(item.get("documentStyle", "")).lower() == "pdf" and item.get("url"):
            return str(item["url"])
    return None


def enrich_publication_access(db: Session, project_id: str, project_payload: dict[str, Any]) -> None:
    publications = project_payload.get("publications")
    if not isinstance(publications, list) or not publications:
        project_payload["publication_access_summary"] = {
            "status": "no_publication",
            "message": "No publication reference was found in PRIDE metadata.",
        }
        return
    for index, publication in enumerate(publications):
        if not isinstance(publication, dict):
            continue
        enrich_single_publication_access(project_id, publication, index)
    downloaded = sum(1 for item in publications if isinstance(item, dict) and item.get("pdf_view_url"))
    publisher = sum(1 for item in publications if isinstance(item, dict) and item.get("access_status") == "publisher_access")
    unresolved = sum(1 for item in publications if isinstance(item, dict) and item.get("access_status") in {"not_resolved", "open_access_pdf_unavailable"})
    project_payload["publication_access_summary"] = {
        "status": "checked",
        "downloaded_pdfs": downloaded,
        "publisher_links": publisher,
        "unresolved": unresolved,
    }


def enrich_single_publication_access(project_id: str, publication: dict[str, Any], index: int) -> None:
    publication["article_url"] = publication.get("article_url") or publication.get("doi_url") or publication.get("pubmed_url")
    if not publication.get("pmid") and not publication.get("doi"):
        publication["access_status"] = "not_resolved"
        publication["access_message"] = "No PMID or DOI is available. Please upload the publication manually."
        return
    if not publication.get("is_open_access"):
        publication["access_status"] = "publisher_access"
        publication["access_message"] = "This article is not marked as open access. Use the publisher/journal link or upload the PDF manually."
        return
    pdf_url = publication.get("pdf_url")
    if not pdf_url:
        publication["access_status"] = "open_access_pdf_unavailable"
        publication["access_message"] = "The article is open access, but Europe PMC did not provide a direct PDF URL. Use the article link or upload the PDF."
        return
    try:
        response = requests.get(str(pdf_url), timeout=PUBLICATION_PDF_TIMEOUT_SECONDS)
        response.raise_for_status()
        content = response.content
        if not content.startswith(b"%PDF-"):
            raise ValueError("The open-access URL did not return a valid PDF file.")
        settings = get_settings()
        import_dir = settings.storage_dir / project_id / "imports"
        import_dir.mkdir(parents=True, exist_ok=True)
        identifier = publication.get("pmid") or publication.get("doi") or f"publication-{index + 1}"
        filename = safe_import_filename(f"publication-{identifier}.pdf")
        local_path = import_dir / filename
        local_path.write_bytes(content)
        publication["access_status"] = "open_access_pdf_downloaded"
        publication["pdf_view_url"] = f"/api/imports/{project_id}/{filename}"
        publication["pdf_filename"] = filename
        publication["access_message"] = "Open-access PDF downloaded automatically."
    except Exception as exc:
        publication["access_status"] = "open_access_pdf_error"
        publication["access_message"] = f"Open-access PDF download failed: {exc}. Use the article link or upload the PDF."


def safe_import_filename(name: str) -> str:
    return "".join(char if char.isalnum() or char in {".", "-", "_"} else "_" for char in name)[:160]


def fetch_pride_file_pages(url: str, timeout: int) -> dict[str, Any]:
    records: list[dict[str, Any]] = []
    seen: set[str] = set()
    page_urls: list[str] = []
    first_error = ""
    for page in range(PRIDE_FILES_MAX_PAGES):
        page_url = url_with_page(url, page)
        result = fetch_pride_json(page_url, timeout=timeout)
        page_urls.append(result["url"])
        if not result["ok"]:
            if page == 0:
                return result
            first_error = result.get("error", "")
            break
        page_records = extract_pride_file_records(result["data"])
        new_records = 0
        for record in page_records:
            key = pride_file_record_key(record)
            if key in seen:
                continue
            seen.add(key)
            records.append(record)
            new_records += 1
        total_pages = extract_total_pages(result["data"])
        if total_pages is not None and page + 1 >= total_pages:
            break
        if not page_records:
            break
        if page > 0 and new_records == 0:
            break
    if not records:
        return {"ok": False, "url": url, "error": first_error or "No file records were returned by the endpoint."}
    return {"ok": True, "url": page_urls[0], "data": records, "page_urls": page_urls}


def url_with_page(url: str, page: int) -> str:
    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query["page"] = str(page)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def pride_file_record_key(record: dict[str, Any]) -> str:
    for key in ("accession", "fileName", "name", "fileNameSubmitted"):
        value = record.get(key)
        if value:
            return f"{key}:{value}"
    locations = record.get("publicFileLocations")
    if isinstance(locations, list):
        for location in locations:
            if isinstance(location, dict) and location.get("value"):
                return f"location:{location['value']}"
    return str(id(record))


def extract_total_pages(data: Any) -> int | None:
    if not isinstance(data, dict):
        return None
    page = data.get("page")
    if isinstance(page, dict):
        total_pages = page.get("totalPages")
        if isinstance(total_pages, int):
            return total_pages
    total_pages = data.get("totalPages")
    return total_pages if isinstance(total_pages, int) else None


def normalize_project_files(accession: str, data: Any) -> dict[str, Any]:
    files = extract_pride_file_records(data)
    raw_file_names: list[str] = []
    other_files_names: list[str] = []
    file_records: list[dict[str, Any]] = []
    existing_sdrf_files: list[dict[str, Any]] = []
    for file in files:
        name = file.get("fileName") or file.get("name") or file.get("fileNameSubmitted") or ""
        if not name:
            continue
        if is_sdrf_file_name(str(name)):
            continue
        category = file.get("fileCategory", {})
        file_type = (
            category.get("value") or category.get("name") or category.get("accession") or ""
            if isinstance(category, dict)
            else str(category)
        ).upper()
        if is_raw_like(name, file_type):
            raw_file_names.append(name)
        else:
            other_files_names.append(name)
        record = {
            "fileName": name,
            "category": file_type,
            "sizeBytes": file.get("fileSizeBytes"),
            "downloadUrl": public_download_url(file),
            "locations": file.get("publicFileLocations", []),
        }
        file_records.append(record)
    roots = extract_root_urls(files)
    return {
        "project_accession": accession,
        "rawfile_count": len(raw_file_names),
        "raw_file_names": raw_file_names,
        "other_files_names": other_files_names,
        "existing_sdrf_files": existing_sdrf_files,
        "file_records": file_records,
        "ftp_root_url": roots["ftp_root_url"],
        "aspera_root_url": roots["aspera_root_url"],
        "total_file_count": len(raw_file_names) + len(other_files_names),
    }


def extract_pride_file_records(data: Any) -> list[dict[str, Any]]:
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)]
    if not isinstance(data, dict):
        return []

    candidates: list[Any] = []
    embedded = data.get("_embedded")
    if isinstance(embedded, dict):
        candidates.extend(
            embedded.get("files")
            or embedded.get("projectFiles")
            or embedded.get("file")
            or []
        )
    for key in ("content", "files", "fileList", "list", "items", "results"):
        value = data.get(key)
        if isinstance(value, list):
            candidates.extend(value)

    if data.get("fileName") or data.get("name") or data.get("fileNameSubmitted"):
        candidates.append(data)

    unique: dict[str, dict[str, Any]] = {}
    for item in candidates:
        if not isinstance(item, dict):
            continue
        name = item.get("fileName") or item.get("name") or item.get("fileNameSubmitted")
        key = str(name) if name else str(id(item))
        unique.setdefault(key, item)
    return list(unique.values())


def is_raw_like(name: str, category: str) -> bool:
    if category in RAW_LIKE_CATEGORIES:
        return True
    name_lower = name.lower()
    return any(name_lower.endswith(ext) or ext + "." in name_lower for ext in RAW_LIKE_EXTENSIONS)


def is_sdrf_file_name(name: str) -> bool:
    lower = name.lower()
    return lower == "sdrf.tsv" or lower.endswith(".sdrf.tsv") or "sdrf" in lower and lower.endswith(".tsv")


def public_download_url(file: dict[str, Any]) -> str:
    for location in file.get("publicFileLocations", []) or []:
        if not isinstance(location, dict):
            continue
        if location.get("name") != "FTP Protocol":
            continue
        value = location.get("value", "") or ""
        if value.startswith("ftp://ftp.pride.ebi.ac.uk/"):
            return "https://ftp.pride.ebi.ac.uk/" + value[len("ftp://ftp.pride.ebi.ac.uk/") :]
        if value.startswith("ftp://"):
            return value.replace("ftp://", "https://", 1)
        return value
    return ""


def extract_root_urls(files: list[dict[str, Any]]) -> dict[str, str | None]:
    ftp_root = None
    aspera_root = None
    for file in files:
        for location in file.get("publicFileLocations", []) or []:
            if not isinstance(location, dict):
                continue
            name = location.get("name", "")
            value = location.get("value", "") or ""
            if not value:
                continue
            parent = value.rsplit("/", 1)[0] + "/"
            if parent.endswith("/generated/"):
                parent = parent[: -len("generated/")]
            if name == "FTP Protocol" and ftp_root is None:
                if parent.startswith("ftp://ftp.pride.ebi.ac.uk/"):
                    ftp_root = "https://ftp.pride.ebi.ac.uk/" + parent[len("ftp://ftp.pride.ebi.ac.uk/") :]
                elif parent.startswith("ftp://"):
                    ftp_root = parent.replace("ftp://", "https://", 1)
                else:
                    ftp_root = parent
            elif name == "Aspera Protocol" and aspera_root is None:
                aspera_root = parent
        if ftp_root and aspera_root:
            break
    return {"ftp_root_url": ftp_root, "aspera_root_url": aspera_root}


def fetch_pride_json(url: str, timeout: int) -> dict[str, Any]:
    try:
        response = requests.get(url, timeout=timeout, headers={"Accept": "application/json"})
        response.raise_for_status()
        text = response.text.strip()
        if not text:
            return {"ok": False, "url": url, "error": "The endpoint returned an empty response."}
        content_type = response.headers.get("content-type", "")
        try:
            return {"ok": True, "url": url, "data": response.json()}
        except ValueError as exc:
            snippet = text[:160].replace("\n", " ")
            return {
                "ok": False,
                "url": url,
                "error": f"The endpoint did not return valid JSON ({content_type}): {exc}. Response starts with: {snippet}",
            }
    except requests.Timeout:
        return {"ok": False, "url": url, "error": f"The request timed out after {timeout} seconds."}
    except Exception as exc:
        return {"ok": False, "url": url, "error": str(exc)}


def add_evidence(
    db: Session,
    project_id: str,
    source_type: str,
    source_ref: str,
    field: str,
    value: str,
    confidence: float,
    payload: dict[str, Any] | None = None,
) -> models.AnalysisEvidence:
    item = models.AnalysisEvidence(
        project_id=project_id,
        source_type=source_type,
        source_ref=source_ref,
        field=field,
        value=value,
        confidence=confidence,
        payload=payload or {},
    )
    db.add(item)
    return item


def ensure_default_sdrf_table(db: Session, project_id: str) -> models.SdrfTable:
    table = db.query(models.SdrfTable).filter(models.SdrfTable.project_id == project_id).one_or_none()
    if table:
        return table
    payload = default_table()
    table = models.SdrfTable(project_id=project_id, **payload)
    db.add(table)
    db.flush()
    return table


def run_analysis(db: Session, project: models.Project) -> dict[str, Any]:
    db.query(models.AnalysisEvidence).filter(
        models.AnalysisEvidence.project_id == project.id,
        models.AnalysisEvidence.source_type != "pride",
    ).delete()
    db.query(models.AssistantQuestion).filter(models.AssistantQuestion.project_id == project.id).delete()
    db.query(models.BlueprintNode).filter(models.BlueprintNode.project_id == project.id).delete()
    db.query(models.MappingEdge).filter(models.MappingEdge.project_id == project.id).delete()

    uploaded = db.query(models.UploadedFile).filter(models.UploadedFile.project_id == project.id).all()
    raw_like_names: list[str] = []
    publication_texts: list[dict[str, Any]] = []
    design_tables: list[dict[str, Any]] = []
    metadata_texts: list[dict[str, Any]] = []
    for file in uploaded:
        path = Path(file.path)
        if file.file_type == "publication-pdf":
            text = extract_pdf_text(path)
            file.extracted_text = text
            file.parse_status = "parsed" if text else "empty"
            add_evidence(db, project.id, "publication-pdf", file.filename, "publication text", text[:5000], 0.7, {"chars": len(text)})
            infer_from_text(db, project.id, text, file.filename)
            publication_texts.append({"source_ref": file.filename, "source_type": "uploaded publication PDF", "text": text})
        elif file.file_type == "design-table":
            parsed = parse_design_file(path)
            file.parsed_payload = parsed
            file.parse_status = "parsed"
            add_evidence(db, project.id, "design-table", file.filename, "table schema", ", ".join(parsed["headers"]), 0.85, parsed)
            seed_table_from_design(db, project.id, parsed)
            raw_like_names.extend(extract_design_file_names(parsed))
            design_tables.append({"source_ref": file.filename, "parsed": parsed})
        elif file.file_type == "metadata":
            text = extract_metadata_text(path)
            file.extracted_text = text
            file.parse_status = "parsed"
            add_evidence(db, project.id, "metadata", file.filename, "metadata text", text[:5000], 0.65, {"chars": len(text)})
            infer_from_text(db, project.id, text, file.filename)
            metadata_texts.append({"source_ref": file.filename, "text": text})
        else:
            if is_raw_like(file.filename, file.file_type.upper()) and not is_sdrf_file_name(file.filename):
                raw_like_names.append(file.filename)

    publication_texts.extend(extract_imported_publication_pdf_texts(project))
    pride_names = extract_pride_raw_file_names(project)
    raw_like_names.extend(pride_names)
    if raw_like_names:
        patterns = detect_file_patterns(raw_like_names)
        add_evidence(db, project.id, "file-names", "uploaded/pride", "file naming pattern", summarize_patterns(patterns), 0.78, {"patterns": patterns})
    sample_evidence = build_sample_evidence_bundle(project, publication_texts, design_tables, metadata_texts, raw_like_names)
    add_evidence(
        db,
        project.id,
        "sample-evidence",
        project.pride_accession or project.name,
        "sample evidence bundle",
        summarize_sample_evidence(sample_evidence),
        0.9,
        sample_evidence,
    )

    create_questions(db, project.id)
    create_blueprint(db, project.id, raw_like_names)
    project.current_step = "samples"
    db.commit()
    return analysis_payload(db, project.id)


def extract_pride_raw_file_names(project: models.Project) -> list[str]:
    names: list[str] = []
    for evidence in project.evidences:
        if evidence.source_type != "pride":
            continue
        names.extend(extract_pride_raw_file_names_from_payload(evidence.payload))
    return [name for name in dict.fromkeys(map(str, names)) if not is_sdrf_file_name(name)]


def extract_pride_raw_file_names_from_payload(payload: dict[str, Any]) -> list[str]:
    files_payload = payload.get("files")
    if not isinstance(files_payload, dict):
        return []
    names: list[str] = [str(name) for name in files_payload.get("raw_file_names", []) if name]
    for item in files_payload.get("file_records", []):
        if not isinstance(item, dict):
            continue
        name = item.get("fileName") or item.get("name")
        category = str(item.get("category", ""))
        if name and is_raw_like(str(name), category):
            names.append(str(name))
    return [name for name in dict.fromkeys(names) if not is_sdrf_file_name(name)]


def extract_pride_file_names(project: models.Project) -> list[str]:
    return extract_pride_raw_file_names(project)


def latest_pride_payload(project: models.Project) -> dict[str, Any]:
    pride_evidence = [item for item in project.evidences if item.source_type == "pride"]
    if not pride_evidence:
        return {}
    return pride_evidence[-1].payload if isinstance(pride_evidence[-1].payload, dict) else {}


def extract_imported_publication_pdf_texts(project: models.Project) -> list[dict[str, Any]]:
    payload = latest_pride_payload(project)
    return extract_imported_publication_pdf_texts_from_payload(project.id, payload)


def extract_imported_publication_pdf_documents(project: models.Project) -> list[dict[str, Any]]:
    payload = latest_pride_payload(project)
    project_payload = payload.get("project") if isinstance(payload.get("project"), dict) else {}
    publications = project_payload.get("publications")
    if not isinstance(publications, list):
        return []
    import_dir = get_settings().storage_dir / project.id / "imports"
    documents: list[dict[str, Any]] = []
    for publication in publications:
        if not isinstance(publication, dict):
            continue
        filename = publication.get("pdf_filename")
        if not filename:
            continue
        path = import_dir / Path(str(filename)).name
        if not path.exists():
            continue
        document = extract_publication_pdf_document(path, str(filename), source_type="PRIDE auto-downloaded publication PDF")
        if document.get("pages"):
            documents.append(document)
    return documents


def extract_imported_publication_pdf_texts_from_payload(project_id: str, payload: dict[str, Any]) -> list[dict[str, Any]]:
    project_payload = payload.get("project")
    if not isinstance(project_payload, dict):
        return []
    publications = project_payload.get("publications")
    if not isinstance(publications, list):
        return []
    import_dir = get_settings().storage_dir / project_id / "imports"
    texts: list[dict[str, Any]] = []
    for publication in publications:
        if not isinstance(publication, dict):
            continue
        filename = publication.get("pdf_filename")
        if not filename:
            continue
        path = import_dir / Path(str(filename)).name
        if not path.exists():
            continue
        text = extract_pdf_text(path)
        if text:
            texts.append({
                "source_ref": str(filename),
                "source_type": "PRIDE auto-downloaded publication PDF",
                "text": text,
            })
    return texts


def build_sample_evidence_bundle(
    project: models.Project,
    publication_texts: list[dict[str, Any]],
    design_tables: list[dict[str, Any]],
    metadata_texts: list[dict[str, Any]],
    raw_file_names: list[str],
) -> dict[str, Any]:
    pride_payload = latest_pride_payload(project)
    return build_sample_evidence_bundle_from_pride_payload(project, pride_payload, publication_texts, design_tables, metadata_texts, raw_file_names)


def build_publication_document_from_pages(
    source_ref: str,
    page_texts: list[str],
    source_type: str = "uploaded publication PDF",
) -> dict[str, Any]:
    pages: list[dict[str, Any]] = []
    total_chars = 0
    truncated = False
    for index, page_text in enumerate(page_texts, start=1):
        text = clean_pdf_document_text(page_text)
        if not text:
            continue
        if len(text) > PUBLICATION_DOCUMENT_PAGE_MAX_CHARS:
            text = text[:PUBLICATION_DOCUMENT_PAGE_MAX_CHARS].rstrip()
            truncated = True
        if total_chars + len(text) > PUBLICATION_DOCUMENT_MAX_CHARS:
            remaining = PUBLICATION_DOCUMENT_MAX_CHARS - total_chars
            if remaining <= 0:
                truncated = True
                break
            text = text[:remaining].rstrip()
            truncated = True
        pages.append({
            "page": index,
            "text": text,
            "char_count": len(text),
        })
        total_chars += len(text)
    return {
        "source_type": source_type,
        "source_ref": source_ref,
        "filename": source_ref,
        "semantic_processing": "none",
        "processing_note": "Mechanical PDF text extraction only; no keyword filtering, no experiment design classification, and no SDRF-derived evidence.",
        "page_count": len(pages),
        "char_count": total_chars,
        "truncated": truncated,
        "pages": pages,
    }


def clean_pdf_document_text(value: str) -> str:
    text = str(value or "").replace("\x00", "")
    text = re.sub(r"(?<=\w)-\s*\n\s*(?=\w)", "", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n[ \t]+", "\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def extract_publication_pdf_document(path: Path, source_ref: str, source_type: str = "uploaded publication PDF") -> dict[str, Any]:
    return build_publication_document_from_pages(
        source_ref,
        extract_pdf_pages(path, max_pages=PUBLICATION_DOCUMENT_MAX_PAGES),
        source_type=source_type,
    )


def build_sample_ai_evidence_input(
    project: models.Project,
    pride_payload: dict[str, Any],
    publication_documents: list[dict[str, Any]],
    raw_file_names: list[str],
    design_tables: list[dict[str, Any]],
    metadata_texts: list[dict[str, Any]],
) -> dict[str, Any]:
    project_payload = pride_payload.get("project") if isinstance(pride_payload.get("project"), dict) else {}
    project_raw = pride_payload.get("project_raw") if isinstance(pride_payload.get("project_raw"), dict) else {}
    raw_summary = summarize_raw_file_names([name for name in raw_file_names if not is_sdrf_file_name(name)])
    return {
        "schema_version": SAMPLE_AI_EVIDENCE_INPUT_SCHEMA_VERSION,
        "task": "Provide raw, model-readable evidence for Samples and Blueprint AI inference without using existing SDRF files.",
        "project_id": project.id,
        "accession": project.pride_accession,
        "evidence_policy": {
            "use_existing_sdrf": False,
            "excluded_sources": ["existing SDRF", "current SDRF table rows"],
            "existing_sdrf_handling": "Do not include downloaded SDRF files, uploaded SDRF files, current SDRF table rows, or SDRF-derived sample mappings in model input.",
        },
        "pdf_processing_policy": {
            "mode": "mechanical_full_text",
            "semantic_processing": "none",
            "model_responsibility": [
                "Read the publication document text.",
                "Infer sample, pool, label, fractionation, assay, replicate, and raw-file relationships from the document plus non-SDRF evidence.",
                "Cite page numbers and exact observed values for every experiment-design decision.",
            ],
        },
        "project_metadata_evidence": {
            "pride_project": {
                "title": project_payload.get("title"),
                "description": project_payload.get("description"),
                "sample_processing_protocol": project_payload.get("sample_processing_protocol"),
                "keywords": project_payload.get("keywords", []),
                "publications": project_payload.get("publications", []),
            },
            "project_metadata": extract_project_sample_metadata(project_raw, project_payload),
        },
        "publication_documents": publication_documents,
        "raw_file_evidence": raw_summary,
        "design_table_evidence": summarize_design_tables(design_tables),
        "metadata_documents": [
            {
                "source_ref": str(item.get("source_ref") or "metadata"),
                "source_type": str(item.get("source_type") or "uploaded metadata"),
                "text": clean_pdf_document_text(str(item.get("text") or ""))[:40_000],
                "semantic_processing": "none",
            }
            for item in metadata_texts
            if clean_pdf_document_text(str(item.get("text") or ""))
        ],
        "output_expectation": {
            "stage_1": "The model should first extract publication facts with page citations.",
            "stage_2": "The model should then generate SDRF Core Mapping JSON from those facts, PRIDE metadata, design/metadata files, and raw file names.",
        },
    }


def build_sample_ai_evidence_input_for_project(db: Session, project: models.Project) -> dict[str, Any]:
    uploaded = db.query(models.UploadedFile).filter(models.UploadedFile.project_id == project.id).all()
    raw_like_names: list[str] = []
    publication_documents: list[dict[str, Any]] = []
    design_tables: list[dict[str, Any]] = []
    metadata_texts: list[dict[str, Any]] = []
    for file in uploaded:
        path = Path(file.path)
        if file.file_type == "publication-pdf":
            try:
                document = extract_publication_pdf_document(path, file.filename)
                file.extracted_text = "\n\n".join(str(page.get("text") or "") for page in document.get("pages", []))
                file.parse_status = "parsed" if document.get("pages") else "empty"
                publication_documents.append(document)
            except Exception as exc:
                file.parse_status = "error"
                file.parsed_payload = {"error": str(exc)}
        elif file.file_type == "design-table":
            parsed = file.parsed_payload if isinstance(file.parsed_payload, dict) and file.parsed_payload else parse_design_file(path)
            file.parsed_payload = parsed
            file.parse_status = "parsed"
            design_tables.append({"source_ref": file.filename, "parsed": parsed})
            raw_like_names.extend(extract_design_file_names(parsed))
        elif file.file_type == "metadata":
            text = file.extracted_text or extract_metadata_text(path)
            file.extracted_text = text
            file.parse_status = "parsed"
            metadata_texts.append({"source_ref": file.filename, "source_type": "uploaded metadata", "text": text})
        elif file.file_type != "sdrf" and is_raw_like(file.filename, file.file_type.upper()):
            raw_like_names.append(file.filename)

    for document in extract_imported_publication_pdf_documents(project):
        publication_documents.append(document)
    raw_like_names.extend(extract_pride_raw_file_names(project))
    payload = build_sample_ai_evidence_input(
        project,
        latest_pride_payload(project),
        publication_documents=publication_documents,
        raw_file_names=raw_like_names,
        design_tables=design_tables,
        metadata_texts=metadata_texts,
    )
    db.flush()
    return payload


def build_sample_evidence_bundle_from_pride_payload(
    project: models.Project,
    pride_payload: dict[str, Any],
    publication_texts: list[dict[str, Any]],
    design_tables: list[dict[str, Any]],
    metadata_texts: list[dict[str, Any]],
    raw_file_names: list[str],
) -> dict[str, Any]:
    project_payload = pride_payload.get("project") if isinstance(pride_payload.get("project"), dict) else {}
    project_raw = pride_payload.get("project_raw") if isinstance(pride_payload.get("project_raw"), dict) else {}
    raw_summary = summarize_raw_file_names([name for name in raw_file_names if not is_sdrf_file_name(name)])
    publication_evidence = extract_sample_text_evidence(publication_texts, "publication PDF")
    metadata_evidence = extract_sample_text_evidence(metadata_texts, "uploaded metadata")
    design_summary = summarize_design_tables(design_tables)
    candidate_grouping_fields = merge_candidate_grouping_fields(
        text_candidate_grouping_fields(publication_evidence, "publication PDF"),
        text_candidate_grouping_fields(metadata_evidence, "uploaded metadata"),
        design_candidate_grouping_fields(design_summary),
    )
    assay_context_fields = raw_summary.get("assay_context_fields", [])
    rejected_grouping_fields = [
        {
            "field": "replicate",
            "reason": "Replicate identifiers support sample_count and biological replicate assignment, not experimental group selection.",
            "source": "raw file summary",
        },
        {
            "field": "fraction",
            "reason": "Fraction labels are treated as assay/preparation context unless explicit evidence says they are biological conditions.",
            "source": "raw file summary",
        },
    ]
    if raw_summary.get("acquisition_methods"):
        rejected_grouping_fields.append({
            "field": "acquisition_method",
            "classification": "assay_file_variable",
            "values": raw_summary.get("acquisition_methods", []),
            "reason": "Acquisition or fragmentation method defines assay/file context, not biological sample grouping on the Samples page.",
            "source": "raw file summary",
        })
    return {
        "schema_version": SAMPLE_EVIDENCE_SCHEMA_VERSION,
        "project_id": project.id,
        "accession": project.pride_accession,
        "evidence_policy": {
            "use_existing_sdrf": False,
            "excluded_sources": ["existing SDRF"],
            "existing_sdrf_handling": "Existing SDRF files are excluded before AI input and evidence bundles are built.",
        },
        "evidence_priority": SAMPLE_EVIDENCE_PRIORITY,
        "pride_project": {
            "title": project_payload.get("title"),
            "description": project_payload.get("description"),
            "sample_processing_protocol": project_payload.get("sample_processing_protocol"),
            "keywords": project_payload.get("keywords", []),
            "publications": project_payload.get("publications", []),
        },
        "project_metadata": extract_project_sample_metadata(project_raw, project_payload),
        "publication_sample_evidence": publication_evidence,
        "design_table_evidence": design_summary,
        "metadata_text_evidence": metadata_evidence,
        "raw_file_summary": raw_summary,
        "candidate_grouping_fields": candidate_grouping_fields,
        "assay_context_fields": assay_context_fields,
        "rejected_grouping_fields": rejected_grouping_fields,
        "grouping_policy": {
            "mode": "ai_select_experimental_conditions",
            "rules": [
                "AI must choose one or more experimental conditions using PDF, raw file list, and metadata together.",
                "replicate supports sample_count and must not be selected as a grouping field.",
                "fraction is assay context unless the evidence explicitly marks it as biological.",
                "acquisition and fragmentation methods are assay/file context, not biological sample grouping fields.",
                "preparation/enrichment can be selected only when the AI explains why it is an experimental comparison axis.",
                "PDF evidence has priority over PRIDE metadata when they conflict.",
                "RAW file names are raw evidence only; AI must infer conditions, replicate groups, fractions, labels, preparations, and acquisition methods from filename patterns and other evidence.",
            ],
        },
    }


def add_pride_import_sample_evidence(db: Session, project: models.Project, payload: dict[str, Any]) -> None:
    raw_file_names = extract_pride_raw_file_names_from_payload(payload)
    db.query(models.AnalysisEvidence).filter(
        models.AnalysisEvidence.project_id == project.id,
        models.AnalysisEvidence.source_type.in_(["file-names", "sample-evidence"]),
        models.AnalysisEvidence.source_ref.in_(["uploaded/pride", project.pride_accession or project.name]),
    ).delete(synchronize_session=False)
    if raw_file_names:
        patterns = detect_file_patterns(raw_file_names)
        add_evidence(db, project.id, "file-names", "uploaded/pride", "file naming pattern", summarize_patterns(patterns), 0.78, {"patterns": patterns})
    publication_texts = extract_imported_publication_pdf_texts_from_payload(project.id, payload)
    sample_evidence = build_sample_evidence_bundle_from_pride_payload(project, payload, publication_texts, [], [], raw_file_names)
    add_evidence(
        db,
        project.id,
        "sample-evidence",
        project.pride_accession or project.name,
        "sample evidence bundle",
        summarize_sample_evidence(sample_evidence),
        0.9,
        sample_evidence,
    )


def summarize_sample_evidence(bundle: dict[str, Any]) -> str:
    raw_summary = bundle.get("raw_file_summary", {})
    snippets = bundle.get("publication_sample_evidence", [])
    raw_count = raw_summary.get("raw_file_count", 0) if isinstance(raw_summary, dict) else 0
    conditions = raw_summary.get("conditions", []) if isinstance(raw_summary, dict) else []
    acquisition_methods = raw_summary.get("acquisition_methods", []) if isinstance(raw_summary, dict) else []
    return (
        f"raw_files={raw_count}; conditions={conditions or ['unknown']}; "
        f"acquisition_methods={acquisition_methods or ['unknown']}; "
        f"publication_snippets={len(snippets) if isinstance(snippets, list) else 0}"
    )


def extract_project_sample_metadata(project_raw: dict[str, Any], project_payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "organisms": extract_cv_terms(project_raw.get("organisms")) or labels_to_terms(project_payload.get("organism")),
        "organism_parts": extract_cv_terms(project_raw.get("organismParts")),
        "diseases": extract_cv_terms(project_raw.get("diseases")),
        "sample_attributes": extract_sample_attributes(project_raw.get("sampleAttributes")),
        "instruments": extract_cv_terms(project_raw.get("instruments")) or labels_to_terms(project_payload.get("instruments")),
        "keywords": project_payload.get("keywords", []),
    }


def extract_cv_terms(value: Any) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    terms: list[dict[str, str]] = []
    for item in value:
        if not isinstance(item, dict):
            if item:
                terms.append({"label": str(item), "accession": "", "ontology": ""})
            continue
        label = str(item.get("name") or item.get("value") or item.get("label") or "")
        accession = normalize_cv_accession(str(item.get("accession") or item.get("id") or ""))
        ontology = str(item.get("cvLabel") or (accession.split(":", 1)[0] if accession else item.get("ontology", "")) or "")
        if label or accession:
            terms.append({"label": label, "accession": accession, "ontology": ontology})
    return terms


def normalize_cv_accession(accession: str) -> str:
    accession = accession.strip()
    if accession.upper().startswith("NEWT:"):
        return "NCBITaxon:" + accession.split(":", 1)[1]
    return accession


def labels_to_terms(value: Any) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    return [{"label": str(item), "accession": "", "ontology": ""} for item in value if item]


def extract_sample_attributes(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    attributes: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        key = item.get("key") if isinstance(item.get("key"), dict) else {}
        values = item.get("value") if isinstance(item.get("value"), list) else []
        attributes.append({
            "field": key.get("name") or key.get("accession") or "",
            "field_accession": normalize_cv_accession(str(key.get("accession") or "")),
            "values": extract_cv_terms(values),
        })
    return attributes


def extract_sample_text_evidence(text_items: list[dict[str, Any]], default_source_type: str) -> list[dict[str, Any]]:
    snippets: list[dict[str, Any]] = []
    seen: set[str] = set()
    keyword_pattern = re.compile("|".join(re.escape(keyword) for keyword in PDF_SAMPLE_KEYWORDS), re.IGNORECASE)
    for item in text_items:
        text = str(item.get("text") or "")
        if not text:
            continue
        source_ref = str(item.get("source_ref") or "text")
        source_type = str(item.get("source_type") or default_source_type)
        for match in keyword_pattern.finditer(text):
            snippet = clean_text_snippet(text[max(0, match.start() - 220): match.end() + 380])
            if len(snippet) < 30:
                continue
            key = f"{source_ref}:{snippet.lower()[:180]}"
            if key in seen:
                continue
            seen.add(key)
            snippets.append({
                "source_type": source_type,
                "source_ref": source_ref,
                "matched_keyword": match.group(0),
                "fields": classify_sample_snippet(snippet),
                "text": snippet,
            })
            if len(snippets) >= 40:
                return snippets
    return snippets


def clean_text_snippet(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def classify_sample_snippet(snippet: str) -> list[str]:
    lower = snippet.lower()
    fields: list[str] = []
    if "hela" in lower or "cell line" in lower:
        fields.append("cell_line")
    if any(term in lower for term in ("treated", "treatment", "stimulated", "egf", "pervanadate", "pervandate", "calyculin", "nocodazole")):
        fields.append("treatment")
    if any(term in lower for term in ("5 min", "15 min", "minute", "hour", "time point", "timepoint")):
        fields.append("timepoint")
    if any(term in lower for term in ("mitosis", "mitotic", "nocodazole", "thymidine")):
        fields.append("cell_cycle_state")
    if any(term in lower for term in ("replicate", "quadruplicate", "triplicate", "biological")):
        fields.append("replicate")
    if any(term in lower for term in ("culture", "medium", "rpmi", "fbs")):
        fields.append("culture_condition")
    return list(dict.fromkeys(fields))


def summarize_design_tables(design_tables: list[dict[str, Any]]) -> list[dict[str, Any]]:
    summaries: list[dict[str, Any]] = []
    for item in design_tables:
        parsed = item.get("parsed") if isinstance(item.get("parsed"), dict) else {}
        headers = [str(header) for header in parsed.get("headers", []) if header]
        summaries.append({
            "source_ref": item.get("source_ref"),
            "headers": headers,
            "row_count": parsed.get("row_count", len(parsed.get("preview", [])) if isinstance(parsed.get("preview"), list) else 0),
            "preview": parsed.get("preview", [])[:12] if isinstance(parsed.get("preview"), list) else [],
            "candidate_grouping_fields": candidate_fields_from_headers(headers, "design table"),
        })
    return summaries


def design_candidate_grouping_fields(design_summary: list[dict[str, Any]]) -> list[dict[str, Any]]:
    fields: list[dict[str, Any]] = []
    for item in design_summary:
        fields.extend(item.get("candidate_grouping_fields", []))
    return fields


def candidate_fields_from_headers(headers: list[str], source: str) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for header in headers:
        field = grouping_field_from_text(header)
        if field:
            candidates.append({"field": field, "source": source, "observed": header, "reason": f"Header '{header}' may encode {field}."})
    return candidates


def text_candidate_grouping_fields(snippets: list[dict[str, Any]], source: str) -> list[dict[str, Any]]:
    values: dict[str, set[str]] = {}
    for snippet in snippets:
        for field in snippet.get("fields", []):
            if field in {"replicate", "culture_condition"}:
                continue
            values.setdefault(field, set()).add(str(snippet.get("matched_keyword") or field))
    return [
        {"field": field, "source": source, "values": sorted(values[field]), "reason": f"{source} snippets contain {field} evidence."}
        for field in sorted(values)
    ]


def grouping_field_from_text(value: str) -> str:
    lower = value.lower()
    if "treatment" in lower or "condition" in lower or "stimulus" in lower or "inhibitor" in lower:
        return "treatment"
    if "time" in lower or "duration" in lower:
        return "timepoint"
    if "dose" in lower or "concentration" in lower:
        return "dose"
    if "cell cycle" in lower or "mitosis" in lower or "mitotic" in lower:
        return "cell_cycle_state"
    if "disease" in lower or "phenotype" in lower:
        return "disease_state"
    if "organism part" in lower or "tissue" in lower:
        return "organism_part"
    if "prep" in lower or "enrichment" in lower or "fractionation" in lower:
        return "preparation"
    if "genotype" in lower:
        return "genotype"
    return ""


def merge_candidate_grouping_fields(*candidate_lists: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for candidates in candidate_lists:
        for candidate in candidates:
            field = str(candidate.get("field") or "")
            if not field:
                continue
            current = merged.setdefault(field, {"field": field, "sources": [], "values": [], "reason": ""})
            source = candidate.get("source")
            if source and source not in current["sources"]:
                current["sources"].append(source)
            for key in ("values", "observed"):
                raw_values = candidate.get(key)
                if raw_values is None:
                    continue
                values = raw_values if isinstance(raw_values, list) else [raw_values]
                for value in values:
                    value = str(value)
                    if value and value not in current["values"]:
                        current["values"].append(value)
            reason = str(candidate.get("reason") or "")
            if reason and reason not in current["reason"]:
                current["reason"] = "; ".join(item for item in [current["reason"], reason] if item)
    return list(merged.values())


def summarize_raw_file_names(raw_file_names: list[str]) -> dict[str, Any]:
    names = [
        name
        for name in dict.fromkeys(str(name) for name in raw_file_names if name)
        if not is_sdrf_file_name(name)
    ]
    return {
        "raw_file_count": len(names),
        "raw_file_names": names,
        "raw_file_examples": names[:20],
        "semantic_parsing": "disabled",
        "interpretation_note": "AI must infer conditions, preparations, replicates, fractions, labels, and acquisition methods from raw_file_names.",
        "assay_context_fields": [],
    }


def infer_from_text(db: Session, project_id: str, text: str, source_ref: str) -> None:
    lower = text.lower()
    if "homo sapiens" in lower or "human" in lower:
        add_evidence(db, project_id, "text", source_ref, "organism", "Homo sapiens (NCBITaxon:9606)", 0.8)
    if "dia" in lower or "data-independent acquisition" in lower:
        add_evidence(db, project_id, "text", source_ref, "acquisition method", "data-independent acquisition", 0.75)
    if "tmt" in lower:
        add_evidence(db, project_id, "text", source_ref, "labeling method", "TMT labeling likely", 0.68)
    if "disease" in lower or "tumor" in lower or "cancer" in lower:
        add_evidence(db, project_id, "text", source_ref, "phenotype", "Disease-related study", 0.55)


def seed_table_from_design(db: Session, project_id: str, parsed: dict[str, Any]) -> None:
    table = ensure_default_sdrf_table(db, project_id)
    incoming_headers = parsed.get("headers", [])
    preview = parsed.get("preview", [])
    if not incoming_headers or table.rows:
        return
    headers = list(dict.fromkeys(table.headers + [header for header in incoming_headers if header not in table.headers]))
    rows = []
    for index, source in enumerate(preview):
        row = {header: "" for header in headers}
        for key, value in source.items():
            row[key] = value
        if not row.get("source name"):
            row["source name"] = f"sample_{index + 1}"
        if not row.get("assay name"):
            row["assay name"] = f"run_{index + 1}"
        rows.append(row)
    table.headers = headers
    table.rows = rows
    table.dirty = True


def extract_design_file_names(parsed: dict[str, Any]) -> list[str]:
    names: list[str] = []
    for row in parsed.get("preview", []):
        if not isinstance(row, dict):
            continue
        value = row.get("comment[data file]") or row.get("Comment[data file]")
        if value:
            names.append(str(value))
    return names


def summarize_patterns(patterns: list[dict[str, Any]]) -> str:
    groups = sorted({item["group"] for item in patterns if item.get("group")})
    fractions = sorted({item["fraction"] for item in patterns if item.get("fraction")})
    replicates = sorted({item["replicate"] for item in patterns if item.get("replicate")})
    return f"groups={groups or ['unknown']}; replicates={replicates or ['unknown']}; fractions={fractions or ['unknown']}"


def create_questions(db: Session, project_id: str) -> None:
    defaults = [
        ("ai-analysis", "Confirm labeling method", "Review whether labels such as TMT/iTRAQ are present.", "medium", ["Open labeling editor", "Mark label free"]),
        ("blueprint", "Map unmapped raw files", "Some file names may not be connected to samples or assay runs.", "medium", ["Open manual mapping", "Ignore sidecar files"]),
        ("samples", "Fill required sample characteristics", "Organism, organism part, disease, and biological replicate are required for robust validation.", "high", ["Fill missing values", "Use ontology search"]),
        ("ontology", "Standardize ontology terms", "Values such as disease and tissue should use controlled vocabulary labels/accessions where possible.", "medium", ["Open ontology review"]),
    ]
    for step, title, message, severity, actions in defaults:
        db.add(models.AssistantQuestion(
            project_id=project_id,
            step=step,
            title=title,
            message=message,
            severity=severity,
            suggested_actions=actions,
        ))


def create_blueprint(db: Session, project_id: str, file_names: list[str]) -> None:
    samples = [
        models.BlueprintNode(project_id=project_id, layer="sample", label="Control", confidence=0.7, payload={"count": 3}),
        models.BlueprintNode(project_id=project_id, layer="sample", label="Disease", confidence=0.6, payload={"count": 3}),
    ]
    prep = models.BlueprintNode(project_id=project_id, layer="preparation", label="Fractionation", confidence=0.65, payload={"fractions": ["F1", "F2", "F3"]})
    assay = models.BlueprintNode(project_id=project_id, layer="assay", label="Assay runs", confidence=0.7, payload={"count": max(1, len(file_names))})
    db.add_all(samples + [prep, assay])
    db.flush()
    for node in samples:
        db.add(models.MappingEdge(project_id=project_id, source_id=node.id, target_id=prep.id, confidence=0.65))
    db.add(models.MappingEdge(project_id=project_id, source_id=prep.id, target_id=assay.id, confidence=0.65))
    for name in file_names[:50]:
        file_node = models.BlueprintNode(project_id=project_id, layer="file", label=name, confidence=0.6, payload={"filename": name})
        db.add(file_node)
        db.flush()
        db.add(models.MappingEdge(project_id=project_id, source_id=assay.id, target_id=file_node.id, confidence=0.55))


def get_blueprint(db: Session, project_id: str) -> dict[str, Any]:
    nodes = db.query(models.BlueprintNode).filter(models.BlueprintNode.project_id == project_id).all()
    edges = db.query(models.MappingEdge).filter(models.MappingEdge.project_id == project_id).all()
    return {
        "nodes": [
            {
                "id": node.id,
                "layer": node.layer,
                "label": node.label,
                "payload": node.payload,
                "confidence": node.confidence,
                "status": node.status,
            }
            for node in nodes
        ],
        "edges": [
            {
                "id": edge.id,
                "source_id": edge.source_id,
                "target_id": edge.target_id,
                "relation": edge.relation,
                "confidence": edge.confidence,
                "status": edge.status,
            }
            for edge in edges
        ],
    }


def replace_blueprint(db: Session, project_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    db.query(models.BlueprintNode).filter(models.BlueprintNode.project_id == project_id).delete()
    db.query(models.MappingEdge).filter(models.MappingEdge.project_id == project_id).delete()
    for node in payload.get("nodes", []):
        db.add(models.BlueprintNode(project_id=project_id, **node))
    for edge in payload.get("edges", []):
        db.add(models.MappingEdge(project_id=project_id, **edge))
    db.commit()
    return get_blueprint(db, project_id)


def analysis_payload(db: Session, project_id: str) -> dict[str, Any]:
    evidences = db.query(models.AnalysisEvidence).filter(models.AnalysisEvidence.project_id == project_id).all()
    questions = db.query(models.AssistantQuestion).filter(models.AssistantQuestion.project_id == project_id).all()
    blueprint = get_blueprint(db, project_id)
    return {
        "evidences": evidences,
        "questions": questions,
        "blueprint": blueprint,
        "summary": {
            "evidence_count": len(evidences),
            "question_count": len(questions),
            "blueprint_nodes": len(blueprint["nodes"]),
            "open_questions": sum(1 for question in questions if question.status == "open"),
        },
    }
