from types import SimpleNamespace

from app.services.analysis import enrich_publication_access, normalize_project_details, normalize_project_files


def test_normalize_project_files_accepts_embedded_pride_response():
    payload = {
        "_embedded": {
            "files": [
                {
                    "fileName": "CTRL_S01_R1_F1.raw",
                    "fileCategory": {"value": "RAW"},
                    "publicFileLocations": [
                        {
                            "name": "FTP Protocol",
                            "value": "ftp://ftp.pride.ebi.ac.uk/pride/data/archive/2024/01/PXD000001/CTRL_S01_R1_F1.raw",
                        }
                    ],
                },
                {"fileName": "sample_metadata.xlsx", "fileCategory": {"value": "RESULT"}},
                {
                    "fileName": "sdrf.tsv",
                    "fileCategory": {"value": "RESULT"},
                    "publicFileLocations": [
                        {
                            "name": "FTP Protocol",
                            "value": "ftp://ftp.pride.ebi.ac.uk/pride/data/archive/2024/01/PXD000001/sdrf.tsv",
                        }
                    ],
                },
            ]
        },
        "page": {"totalElements": 3},
    }

    result = normalize_project_files("PXD000001", payload)

    assert result["rawfile_count"] == 1
    assert result["total_file_count"] == 2
    assert result["raw_file_names"] == ["CTRL_S01_R1_F1.raw"]
    assert result["other_files_names"] == ["sample_metadata.xlsx"]
    assert result["existing_sdrf_files"] == []
    assert all(record["fileName"] != "sdrf.tsv" for record in result["file_records"])
    assert result["ftp_root_url"] == "https://ftp.pride.ebi.ac.uk/pride/data/archive/2024/01/PXD000001/"


def test_normalize_project_files_classifies_raw_like_by_extension():
    payload = {
        "content": [
            {"fileName": "run01.d.tar", "fileCategory": {"value": "OTHER"}},
            {"fileName": "results.tsv", "fileCategory": "RESULT"},
        ]
    }

    result = normalize_project_files("PXD000002", payload)

    assert result["raw_file_names"] == ["run01.d.tar"]
    assert result["other_files_names"] == ["results.tsv"]


def test_normalize_project_details_accepts_string_and_object_lists(monkeypatch):
    monkeypatch.setattr("app.services.analysis.europe_pmc_lookup", lambda _query: None)
    payload = {
        "accession": "PXD000003",
        "title": "Example project",
        "organisms": [{"name": "Homo sapiens"}, "Mus musculus"],
        "instruments": [{"value": "Orbitrap Eclipse"}],
        "identifiedPTMStrings": ["Oxidation"],
        "references": [{"pubmedID": "123", "doi": "10.123/test", "referenceLine": "Example reference"}],
    }

    result = normalize_project_details(payload)

    assert result["organism"] == ["Homo sapiens", "Mus musculus"]
    assert result["instruments"] == ["Orbitrap Eclipse"]
    assert result["modifications"] == ["Oxidation"]
    assert result["publications"][0]["pmid"] == "123"


def test_enrich_publication_access_downloads_open_access_pdf(monkeypatch, tmp_path):
    class Response:
        content = b"%PDF- fake pdf"

        def raise_for_status(self):
            return None

    monkeypatch.setattr("app.services.analysis.get_settings", lambda: SimpleNamespace(storage_dir=tmp_path))
    monkeypatch.setattr("app.services.analysis.requests.get", lambda *_args, **_kwargs: Response())
    project = {
        "publications": [
            {
                "pmid": "123",
                "doi": "10.123/example",
                "title": "Open article",
                "is_open_access": True,
                "pdf_url": "https://example.test/article.pdf",
                "article_url": "https://doi.org/10.123/example",
            }
        ]
    }

    enrich_publication_access(None, "project-1", project)

    publication = project["publications"][0]
    assert publication["access_status"] == "open_access_pdf_downloaded"
    assert publication["pdf_view_url"].endswith(".pdf")
    assert (tmp_path / "project-1" / "imports" / publication["pdf_filename"]).exists()


def test_enrich_publication_access_keeps_journal_link_for_closed_article(monkeypatch, tmp_path):
    monkeypatch.setattr("app.services.analysis.get_settings", lambda: SimpleNamespace(storage_dir=tmp_path))
    project = {
        "publications": [
            {
                "pmid": "24274931",
                "doi": "10.1021/pr4009157",
                "title": "Closed article",
                "is_open_access": False,
                "article_url": "https://doi.org/10.1021/pr4009157",
            }
        ]
    }

    enrich_publication_access(None, "project-1", project)

    publication = project["publications"][0]
    assert publication["access_status"] == "publisher_access"
    assert publication["article_url"] == "https://doi.org/10.1021/pr4009157"
    assert "pdf_view_url" not in publication
