from app.services.extractors import detect_file_patterns
from app.services import sdrf as sdrf_service
from app.services.sdrf import parse_text_table, table_to_tsv, validate_table


def test_sdrf_roundtrip_tsv():
    source = "source name\tassay name\tcomment[data file]\ns1\tr1\tfile.raw\n"
    table = parse_text_table(source)
    assert table["headers"] == ["source name", "assay name", "comment[data file]"]
    assert table["rows"][0]["source name"] == "s1"
    assert table_to_tsv(table["headers"], table["rows"]) == source


def test_structural_validation_reports_missing_columns():
    table = parse_text_table("source name\tassay name\tcomment[data file]\ns1\tr1\tfile.raw\n")
    issues, summary = validate_table(table["headers"], table["rows"])
    assert summary["errors"] > 0
    assert any("characteristics[organism]" in issue["message"] for issue in issues)


def test_validation_uses_sdrf_pipeline_cli_when_available(monkeypatch):
    calls = []

    class Completed:
        returncode = 0
        stdout = ""
        stderr = ""

    def fake_run(command, **kwargs):
        calls.append((command, kwargs))
        return Completed()

    monkeypatch.setattr(sdrf_service.shutil, "which", lambda name: "/usr/bin/sdrf" if name == "sdrf" else None)
    monkeypatch.setattr(sdrf_service.subprocess, "run", fake_run)

    table = parse_text_table("source name\tassay name\tcomment[data file]\ns1\tr1\tfile.raw\n")
    issues, summary = validate_table(table["headers"], table["rows"])

    assert issues == []
    assert summary["validator"] == "sdrf-pipelines"
    assert calls
    assert calls[0][0][:3] == ["/usr/bin/sdrf", "validate", "-s"]


def test_validation_accepts_sdrf_pipelines_executable_name(monkeypatch):
    calls = []

    class Completed:
        returncode = 0
        stdout = ""
        stderr = ""

    def fake_which(name):
        return "/usr/bin/sdrf-pipelines" if name == "sdrf-pipelines" else None

    def fake_run(command, **kwargs):
        calls.append((command, kwargs))
        return Completed()

    monkeypatch.setattr(sdrf_service.shutil, "which", fake_which)
    monkeypatch.setattr(sdrf_service.subprocess, "run", fake_run)

    table = parse_text_table("source name\tassay name\tcomment[data file]\ns1\tr1\tfile.raw\n")
    issues, summary = validate_table(table["headers"], table["rows"])

    assert issues == []
    assert summary["validator"] == "sdrf-pipelines"
    assert calls
    assert calls[0][0][:3] == ["/usr/bin/sdrf-pipelines", "validate", "-s"]


def test_file_pattern_detection():
    patterns = detect_file_patterns(["CTRL_S01_R1_F1.raw", "DIS_S02_R2_F3.raw"])
    assert patterns[0]["group"] == "Control"
    assert patterns[1]["group"] == "Disease"
    assert patterns[1]["fraction"].upper() == "F3"
