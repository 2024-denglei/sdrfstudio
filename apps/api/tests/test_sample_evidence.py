from types import SimpleNamespace

from app.services.analysis import (
    build_publication_document_from_pages,
    build_sample_ai_evidence_input,
    build_sample_evidence_bundle,
    build_sample_evidence_bundle_from_pride_payload,
    extract_pride_raw_file_names_from_payload,
    extract_sample_text_evidence,
    fetch_pride_file_pages,
    summarize_raw_file_names,
)


def test_fetch_pride_file_pages_merges_all_pages(monkeypatch):
    pages = {
        0: [{"fileName": "run_1.raw", "fileCategory": {"value": "RAW"}}],
        1: [{"fileName": "run_2.raw", "fileCategory": {"value": "RAW"}}],
        2: [],
    }

    def fake_fetch(url, timeout):
        page = int(url.rsplit("page=", 1)[1])
        return {"ok": True, "url": url, "data": pages[page]}

    monkeypatch.setattr("app.services.analysis.fetch_pride_json", fake_fetch)

    result = fetch_pride_file_pages("https://example.test/files?pageSize=100", timeout=1)

    assert result["ok"] is True
    assert [item["fileName"] for item in result["data"]] == ["run_1.raw", "run_2.raw"]


def test_summarize_raw_file_names_preserves_raw_names_without_semantic_parsing():
    summary = summarize_raw_file_names([
        "20120415_EXQ5_KiSh_SA_LabelFree_HeLa_pY_Noco_rep1.raw",
        "20120415_EXQ5_KiSh_SA_LabelFree_HeLa_pY_Noco_rep2.raw",
        "20120413_EXQ5_KiSh_SA_LabelFree_HeLa_pY_pervandate_rep2.raw",
        "sdrf.tsv",
    ])

    assert summary["raw_file_count"] == 3
    assert summary["raw_file_names"] == [
        "20120415_EXQ5_KiSh_SA_LabelFree_HeLa_pY_Noco_rep1.raw",
        "20120415_EXQ5_KiSh_SA_LabelFree_HeLa_pY_Noco_rep2.raw",
        "20120413_EXQ5_KiSh_SA_LabelFree_HeLa_pY_pervandate_rep2.raw",
    ]
    assert summary["raw_file_examples"] == summary["raw_file_names"]
    assert summary["semantic_parsing"] == "disabled"
    assert "AI must infer conditions, preparations, replicates, fractions, labels, and acquisition methods from raw_file_names." in summary["interpretation_note"]
    assert "conditions" not in summary
    assert "preparations" not in summary
    assert "replicates" not in summary
    assert "fractions" not in summary
    assert "groups_by_condition" not in summary
    assert "groups_by_preparation_condition" not in summary
    assert "candidate_grouping_fields" not in summary


def test_extract_sample_text_evidence_finds_pdf_sample_snippets():
    snippets = extract_sample_text_evidence([
        {
            "source_ref": "paper.pdf",
            "text": (
                "HeLa S3 cells were left untreated or stimulated with epidermal growth factor "
                "(EGF) for 5 or 15 min. We used a double thymidine block in combination with "
                "nocodazole arrest. A separate population was treated with sodium pervanadate "
                "and calyculin A."
            ),
        }
    ], "publication PDF")

    text = " ".join(item["text"] for item in snippets)
    fields = {field for item in snippets for field in item["fields"]}
    assert "HeLa S3" in text
    assert "EGF" in text
    assert "nocodazole" in text
    assert "pervanadate" in text
    assert {"cell_line", "treatment", "timepoint", "cell_cycle_state"}.issubset(fields)


def test_publication_document_keeps_pdf_page_text_without_keyword_filtering():
    document = build_publication_document_from_pages(
        "PXD000547.pdf",
        [
            "Clinical Samples. Brain samples were dissected by a neuropathologist.",
            (
                "We set up two pools for ATL and CC samples from eight subjects. "
                "Subjects 1-4 comprised separate ATL and CC pool, whereas 5-8 comprised other ATL and CC pools."
            ),
            "Each gel lane containing stained protein bands was sliced equally into 20 sections.",
        ],
    )

    text = " ".join(page["text"] for page in document["pages"])
    assert document["source_type"] == "uploaded publication PDF"
    assert document["page_count"] == 3
    assert "two pools" in text
    assert "Subjects 1-4" in text
    assert "20 sections" in text
    assert document["semantic_processing"] == "none"


def test_sample_ai_evidence_input_uses_pdf_documents_and_excludes_existing_sdrf():
    project = SimpleNamespace(
        id="project-1",
        name="PXD000547 session",
        pride_accession="PXD000547",
    )
    pride_payload = {
        "project": {
            "title": "Proteome of the Human Corpus Callosum",
            "description": "Corpus callosum proteome study.",
            "sample_processing_protocol": "Protein (40 ug) from a pooled sample was separated by SDS-PAGE.",
            "keywords": ["human", "corpus callosum"],
        },
        "project_raw": {
            "organisms": [{"cvLabel": "NEWT", "accession": "NEWT:9606", "name": "Homo sapiens"}],
        },
        "files": {
            "existing_sdrf_files": [{"fileName": "sdrf.tsv", "downloadUrl": "https://example.test/sdrf.tsv"}],
        },
    }
    pdf_document = build_publication_document_from_pages(
        "PXD000547.pdf",
        [
            (
                "We set up two pools for ATL and CC samples from eight subjects. "
                "Subjects 1-4 comprised separate ATL and CC pool, whereas 5-8 comprised other ATL and CC pools."
            )
        ],
    )

    payload = build_sample_ai_evidence_input(
        project,
        pride_payload,
        publication_documents=[pdf_document],
        raw_file_names=[
            "dms_04Jul13_CC_Proteome_Slice01_01.RAW",
            "dms_04Jul13_CC_Proteome_Slice01_02.RAW",
        ],
        design_tables=[],
        metadata_texts=[],
    )

    payload_text = str(payload)
    assert payload["evidence_policy"]["use_existing_sdrf"] is False
    assert payload["evidence_policy"]["excluded_sources"] == ["existing SDRF", "current SDRF table rows"]
    assert payload["publication_documents"][0]["pages"][0]["text"].startswith("We set up two pools")
    assert payload["raw_file_evidence"]["raw_file_count"] == 2
    assert "dms_04Jul13_CC_Proteome_Slice01_01.RAW" in payload["raw_file_evidence"]["raw_file_names"]
    assert "sdrf.tsv" not in payload_text


def test_build_sample_evidence_bundle_excludes_existing_sdrf_and_prioritizes_pdf():
    project = SimpleNamespace(
        id="project-1",
        name="Example",
        pride_accession="PXD000612",
        evidences=[
            SimpleNamespace(
                source_type="pride",
                payload={
                    "project": {
                        "title": "Example project",
                        "description": "PRIDE description",
                        "sample_processing_protocol": "PRIDE protocol",
                        "keywords": ["HeLa"],
                    },
                    "project_raw": {
                        "organisms": [{"cvLabel": "NEWT", "accession": "NEWT:9606", "name": "Homo sapiens"}],
                        "organismParts": [{"cvLabel": "BTO", "accession": "BTO:0000214", "name": "cell culture"}],
                    },
                    "files": {
                        "existing_sdrf_files": [{"fileName": "sdrf.tsv", "downloadUrl": "https://example.test/sdrf.tsv"}],
                    },
                },
            )
        ],
    )

    bundle = build_sample_evidence_bundle(
        project,
        [{"source_ref": "paper.pdf", "text": "HeLa S3 cells were treated with EGF for 5 or 15 min."}],
        [],
        [],
        ["HeLa_Proteome_EGF15_rep1_pH11.raw", "sdrf.tsv"],
    )

    assert bundle["schema_version"] == "sample-evidence-v1"
    assert bundle["evidence_policy"]["use_existing_sdrf"] is False
    assert "sdrf.tsv" not in str(bundle["evidence_policy"])
    assert bundle["evidence_priority"][0] == "publication PDF sample evidence"
    assert bundle["raw_file_summary"]["raw_file_count"] == 1
    assert bundle["project_metadata"]["organisms"][0]["accession"] == "NCBITaxon:9606"
    assert any(item["field"] == "treatment" for item in bundle["candidate_grouping_fields"])


def test_pride_import_payload_can_seed_sample_evidence_without_analysis_run():
    project = SimpleNamespace(
        id="project-1",
        name="Imported project",
        pride_accession="PXD000070",
    )
    pride_payload = {
        "project": {
            "title": "Plasmodium falciparum schizont phosphoproteome",
            "description": "Schizont proteins were extracted and phosphopeptides enriched using IMAC.",
            "sample_processing_protocol": "Not available",
            "keywords": ["Plasmodium falciparum", "Phosphoproteome"],
        },
        "project_raw": {
            "organisms": [{"cvLabel": "NEWT", "accession": "NEWT:36329", "name": "Plasmodium falciparum (isolate 3D7)"}],
        },
        "files": {
            "raw_file_names": ["OTPf-IMACDDNL_2010Mar06-01.raw"],
            "file_records": [
                {"fileName": "OTPf-IMACDDNL_2010Mar06-02.raw", "category": "RAW"},
                {"fileName": "README.txt", "category": "RESULT"},
                {"fileName": "sdrf.tsv", "category": "RESULT"},
            ],
            "existing_sdrf_files": [{"fileName": "sdrf.tsv", "downloadUrl": "https://example.test/sdrf.tsv"}],
        },
    }

    raw_names = extract_pride_raw_file_names_from_payload(pride_payload)
    bundle = build_sample_evidence_bundle_from_pride_payload(project, pride_payload, [], [], [], raw_names)

    assert raw_names == ["OTPf-IMACDDNL_2010Mar06-01.raw", "OTPf-IMACDDNL_2010Mar06-02.raw"]
    assert bundle["raw_file_summary"]["raw_file_count"] == 2
    assert "sdrf.tsv" not in str(bundle["evidence_policy"])
    assert bundle["project_metadata"]["organisms"][0]["accession"] == "NCBITaxon:36329"


def test_raw_file_names_do_not_capture_acquisition_methods_as_assay_context():
    summary = summarize_raw_file_names([
        "OTPf-IMACDDNL_2010Mar9-01.raw",
        "OTPf-IMACDT2010Mar11-01.raw",
        "OTPf-IMACDT2010Mar11-02.raw",
        "OTPf-IMACDDNL_2010Mar9-02.raw",
    ])

    assert summary["raw_file_count"] == 4
    assert summary["raw_file_names"] == [
        "OTPf-IMACDDNL_2010Mar9-01.raw",
        "OTPf-IMACDT2010Mar11-01.raw",
        "OTPf-IMACDT2010Mar11-02.raw",
        "OTPf-IMACDDNL_2010Mar9-02.raw",
    ]
    assert "acquisition_methods" not in summary
    assert "groups_by_acquisition_method" not in summary
    assert summary["assay_context_fields"] == []
