from fastapi.testclient import TestClient
import json
from types import SimpleNamespace

from app.core.database import init_db
from app.core.config import get_settings
from app.main import app
from app.services.analysis import build_publication_document_from_pages


def test_project_validation_export_flow():
    init_db()
    client = TestClient(app)

    created = client.post("/api/projects", json={"name": "API Test Project"}).json()
    project_id = created["id"]

    table = client.get(f"/api/projects/{project_id}/sdrf/table").json()
    assert "source name" in table["headers"]

    validation = client.post(f"/api/projects/{project_id}/validate").json()
    assert validation["summary"]["validator"] in {"structural-fallback", "sdrf-pipelines"}

    exports = client.post(f"/api/projects/{project_id}/export").json()
    assert any(record["export_type"] == "sdrf-tsv" for record in exports)


def test_analysis_moves_workflow_to_samples_before_blueprint():
    init_db()
    client = TestClient(app)

    created = client.post("/api/projects", json={"name": "Workflow Order Test"}).json()
    project_id = created["id"]

    client.post(f"/api/projects/{project_id}/analysis/run")
    project = client.get(f"/api/projects/{project_id}").json()

    assert project["current_step"] == "samples"


def test_download_imported_sdrf_file():
    init_db()
    client = TestClient(app)

    created = client.post("/api/projects", json={"name": "Imported SDRF Test"}).json()
    project_id = created["id"]
    import_dir = get_settings().storage_dir / project_id / "imports"
    import_dir.mkdir(parents=True, exist_ok=True)
    path = import_dir / "sdrf.tsv"
    path.write_text("source name\tassay name\tcomment[data file]\ns1\ta1\tfile.raw\n", encoding="utf-8")

    response = client.get(f"/api/imports/{project_id}/sdrf.tsv")

    assert response.status_code == 200
    assert response.text.startswith("source name\tassay name")


def test_upload_sdrf_is_ignored_as_generation_input_even_when_requested():
    init_db()
    client = TestClient(app)

    created = client.post("/api/projects", json={"name": "Ignore Uploaded SDRF Test"}).json()
    project_id = created["id"]
    before_table = client.get(f"/api/projects/{project_id}/sdrf/table").json()

    upload = client.post(
        f"/api/projects/{project_id}/files",
        files={"file": ("existing.sdrf.tsv", b"source name\tassay name\tcomment[data file]\nimported_s1\timported_run\timported.raw\n", "text/tab-separated-values")},
        data={"file_type": "sdrf"},
    ).json()
    after_table = client.get(f"/api/projects/{project_id}/sdrf/table").json()

    assert upload["file_type"] == "supplementary"
    assert upload["parse_status"] == "ignored"
    assert upload["parsed_payload"]["reason"] == "Existing SDRF files are not used as SDRF Studio inputs."
    assert after_table["headers"] == before_table["headers"]
    assert after_table["rows"] == before_table["rows"]


def test_pride_import_does_not_download_or_expose_existing_sdrf(monkeypatch):
    init_db()
    client = TestClient(app)

    def fail_sdrf_download(*_args, **_kwargs):
        raise AssertionError("Existing SDRF files must not be downloaded during PRIDE import.")

    monkeypatch.setattr("app.services.analysis.fetch_pride_json", lambda *_args, **_kwargs: {
        "ok": True,
        "data": {"accession": "PXD000001", "title": "Project without SDRF input", "references": []},
        "url": "https://example.test/project",
    })
    monkeypatch.setattr("app.services.analysis.fetch_pride_file_pages", lambda *_args, **_kwargs: {
        "ok": True,
        "data": {
            "_embedded": {
                "files": [
                    {"fileName": "sample_01.raw", "fileCategory": {"value": "RAW"}},
                    {
                        "fileName": "sdrf.tsv",
                        "fileCategory": {"value": "RESULT"},
                        "publicFileLocations": [{"name": "FTP Protocol", "value": "ftp://ftp.pride.ebi.ac.uk/pride/data/archive/2024/01/PXD000001/sdrf.tsv"}],
                    },
                ],
            },
        },
        "url": "https://example.test/files",
    })
    monkeypatch.setattr("app.services.analysis.requests.get", fail_sdrf_download)

    created = client.post("/api/projects", json={"name": "PRIDE Ignore SDRF Test"}).json()
    response = client.post(f"/api/projects/{created['id']}/imports/pride", json={"accession": "PXD000001"})

    assert response.status_code == 200
    payload = response.json()
    assert "files_raw" not in payload
    assert payload["files"]["raw_file_names"] == ["sample_01.raw"]
    assert payload["files"]["existing_sdrf_files"] == []
    assert "sdrf.tsv" not in json.dumps(payload)


def test_ai_chat_proxy_requires_server_configuration(monkeypatch):
    init_db()
    client = TestClient(app)
    monkeypatch.setattr("app.services.ai_client.get_settings", lambda: SimpleNamespace(
        enable_cloud_ai=False,
        openai_api_key="",
        deepseek_api_key="",
        ai_chat_base_url="https://provider.example/v1/chat/completions",
        ai_chat_timeout_seconds=30,
        openai_model="server-model",
    ))

    response = client.post("/api/ai/chat", json={"messages": [{"role": "user", "content": "hello"}]})

    assert response.status_code == 503
    assert "not configured" in response.json()["detail"].lower()


def test_ai_chat_proxy_forwards_with_server_side_secret(monkeypatch):
    init_db()
    client = TestClient(app)
    captured: dict[str, object] = {}
    monkeypatch.setattr("app.services.ai_client.get_settings", lambda: SimpleNamespace(
        enable_cloud_ai=True,
        openai_api_key="server-only-key",
        deepseek_api_key="",
        ai_chat_base_url="https://provider.example/v1/chat/completions",
        ai_chat_timeout_seconds=45,
        openai_model="server-model",
    ))

    class Response:
        status_code = 200
        text = "{\"choices\": []}"

        def json(self):
            return {"choices": [{"message": {"content": "{\"ok\":true}"}}]}

    def fake_post(url, *, headers, json, timeout):
        captured["url"] = url
        captured["headers"] = headers
        captured["json"] = json
        captured["timeout"] = timeout
        return Response()

    monkeypatch.setattr("app.services.ai_client.requests.post", fake_post)

    response = client.post("/api/ai/chat", json={
        "model": "client-selected-model",
        "messages": [{"role": "user", "content": "build SDRF"}],
        "authorization": "must-not-forward",
    })

    assert response.status_code == 200
    assert captured["url"] == "https://provider.example/v1/chat/completions"
    assert captured["timeout"] == 45
    assert captured["headers"] == {
        "Authorization": "Bearer server-only-key",
        "Content-Type": "application/json",
    }
    assert captured["json"] == {
        "model": "client-selected-model",
        "messages": [{"role": "user", "content": "build SDRF"}],
    }
    assert response.json()["choices"][0]["message"]["content"] == "{\"ok\":true}"


def test_validation_treats_canonical_headers_even_when_legacy_case_variants_exist():
    init_db()
    client = TestClient(app)

    created = client.post("/api/projects", json={"name": "Legacy Header Validation Test"}).json()
    project_id = created["id"]
    table = client.get(f"/api/projects/{project_id}/sdrf/table").json()
    table["headers"] = [
        "Source Name",
        "Characteristics[organism]",
        "characteristics[organism part]",
        "characteristics[disease]",
        "characteristics[biological replicate]",
        "assay name",
        "technology type",
        "comment[proteomics data acquisition method]",
        "comment[label]",
        "comment[instrument]",
        "comment[cleavage agent details]",
        "comment[fraction identifier]",
        "comment[technical replicate]",
        "comment[data file]",
        "factor value[disease]",
    ]
    table["rows"] = [{
        "Source Name": "sample_01",
        "Characteristics[organism]": "Homo sapiens",
        "characteristics[organism part]": "corpus callosum",
        "characteristics[disease]": "normal",
        "characteristics[biological replicate]": "1",
        "assay name": "assay_01",
        "technology type": "mass spectrometry",
        "comment[proteomics data acquisition method]": "DDA",
        "comment[label]": "label free sample",
        "comment[instrument]": "LTQ Orbitrap XL",
        "comment[cleavage agent details]": "Trypsin",
        "comment[fraction identifier]": "1",
        "comment[technical replicate]": "1",
        "comment[data file]": "sample_01.raw",
        "factor value[disease]": "normal",
    }]
    table["column_metadata"] = {}
    table["dirty"] = True
    table["validation_state"] = {}

    client.put(f"/api/projects/{project_id}/sdrf/table", json=table)
    normalized = client.get(f"/api/projects/{project_id}/sdrf/table").json()

    assert "Source Name" not in normalized["headers"]
    assert "source name" in normalized["headers"]
    assert normalized["rows"][0]["source name"] == "sample_01"
    assert "Characteristics[organism]" not in normalized["headers"]
    assert normalized["rows"][0]["characteristics[organism]"] == "Homo sapiens"
    validation = client.post(f"/api/projects/{project_id}/validate").json()

    assert validation["summary"]["errors"] == 0
    assert validation["summary"]["validator"] in {"structural-fallback", "sdrf-pipelines"}


def test_preview_uploaded_pdf_file():
    init_db()
    client = TestClient(app)

    created = client.post("/api/projects", json={"name": "Preview PDF Test"}).json()
    project_id = created["id"]
    upload = client.post(
        f"/api/projects/{project_id}/files",
        files={"file": ("paper.pdf", b"%PDF- fake pdf", "application/pdf")},
    ).json()

    response = client.get(f"/api/projects/{project_id}/files/{upload['id']}/preview")

    assert response.status_code == 200
    assert response.content.startswith(b"%PDF-")


def test_sample_ai_input_endpoint_includes_pdf_pages_without_sdrf(monkeypatch):
    init_db()
    client = TestClient(app)

    def fake_extract_pdf_document(path, source_ref, source_type="uploaded publication PDF"):
        return build_publication_document_from_pages(
            source_ref,
            [
                "We set up two pools for ATL and CC samples from eight subjects.",
                "Each gel lane containing stained protein bands was sliced equally into 20 sections.",
            ],
            source_type=source_type,
        )

    monkeypatch.setattr("app.services.analysis.extract_publication_pdf_document", fake_extract_pdf_document)

    created = client.post("/api/projects", json={"name": "Sample AI PDF Input Test"}).json()
    project_id = created["id"]
    client.post(
        f"/api/projects/{project_id}/files",
        files={"file": ("paper.pdf", b"%PDF- fake pdf", "application/pdf")},
        data={"file_type": "publication-pdf"},
    )

    response = client.post(f"/api/projects/{project_id}/ai/sample-design-input")

    assert response.status_code == 200
    payload = response.json()
    assert payload["evidence_policy"]["use_existing_sdrf"] is False
    assert payload["evidence_policy"]["excluded_sources"] == ["existing SDRF", "current SDRF table rows"]
    assert payload["publication_documents"][0]["semantic_processing"] == "none"
    text = " ".join(page["text"] for page in payload["publication_documents"][0]["pages"])
    assert "two pools" in text
    assert "20 sections" in text
    assert "sdrf.tsv" not in str(payload)


def test_delete_project_removes_session_records_and_storage():
    init_db()
    client = TestClient(app)

    created = client.post("/api/projects", json={"name": "Delete Session Test"}).json()
    project_id = created["id"]
    storage_dir = get_settings().storage_dir / project_id
    import_dir = storage_dir / "imports"
    import_dir.mkdir(parents=True, exist_ok=True)
    (import_dir / "paper.pdf").write_bytes(b"%PDF- imported paper")

    client.post(
        f"/api/projects/{project_id}/files",
        files={"file": ("design.tsv", b"source name\tassay name\ns1\ta1\n", "text/tab-separated-values")},
        data={"file_type": "design-table"},
    )
    client.post(f"/api/projects/{project_id}/analysis/run")
    client.post(f"/api/projects/{project_id}/validate")
    client.post(f"/api/projects/{project_id}/export")

    assert storage_dir.exists()

    response = client.delete(f"/api/projects/{project_id}")

    assert response.status_code == 200
    assert response.json() == {"status": "deleted"}
    assert client.get(f"/api/projects/{project_id}").status_code == 404
    assert all(project["id"] != project_id for project in client.get("/api/projects").json())
    assert not storage_dir.exists()


def test_save_sample_ai_prompt_writes_debug_payload_without_secrets():
    init_db()
    client = TestClient(app)

    created = client.post("/api/projects", json={"name": "Prompt Debug Test"}).json()
    project_id = created["id"]
    debug_dir = get_settings().storage_dir / project_id / "debug" / "sample-ai-prompts"
    payload = {
        "model": "debug-model",
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": "system prompt"},
            {"role": "user", "content": "{\"project_id\":\"project-1\"}"},
        ],
        "api_key": "should-not-be-written",
        "headers": {"Authorization": "Bearer should-not-be-written"},
    }

    response = client.post(f"/api/projects/{project_id}/debug/sample-ai-prompts", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "saved"
    saved_path = debug_dir / body["filename"]
    assert saved_path.exists()
    saved = json.loads(saved_path.read_text(encoding="utf-8"))
    assert saved["project_id"] == project_id
    assert saved["request_body"]["model"] == "debug-model"
    assert saved["request_body"]["messages"][0]["content"] == "system prompt"
    assert "api_key" not in saved["request_body"]
    assert saved["request_body"]["headers"]["Authorization"] == "[redacted]"
