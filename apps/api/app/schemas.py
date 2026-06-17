from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str = ""


class ProjectOut(BaseModel):
    id: str
    name: str
    description: str
    status: str
    pride_accession: str | None
    current_step: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PrideImportRequest(BaseModel):
    accession: str = Field(pattern=r"^PXD\d{6,}$")


class UploadedFileOut(BaseModel):
    id: str
    project_id: str
    filename: str
    content_type: str
    file_type: str
    sha256: str
    size_bytes: int
    parse_status: str
    parsed_payload: dict[str, Any] = {}
    created_at: datetime

    model_config = {"from_attributes": True}


class SdrfTablePayload(BaseModel):
    headers: list[str]
    rows: list[dict[str, Any]]
    column_metadata: dict[str, Any] = {}
    dirty: bool = False
    validation_state: dict[str, Any] = {}


class SdrfTableOut(SdrfTablePayload):
    id: str | None = None
    project_id: str


class EvidenceItem(BaseModel):
    id: str
    source_type: str
    source_ref: str
    field: str
    value: str
    confidence: float
    payload: dict[str, Any]
    status: str

    model_config = {"from_attributes": True}


class AssistantQuestionOut(BaseModel):
    id: str
    step: str
    title: str
    message: str
    severity: str
    suggested_actions: list[str]
    status: str
    payload: dict[str, Any]

    model_config = {"from_attributes": True}


class BlueprintNodePayload(BaseModel):
    id: str
    layer: Literal["sample", "preparation", "assay", "file"]
    label: str
    payload: dict[str, Any] = {}
    confidence: float = 0.5
    status: str = "suggested"


class MappingEdgePayload(BaseModel):
    id: str
    source_id: str
    target_id: str
    relation: str = "maps_to"
    confidence: float = 0.5
    status: str = "suggested"


class BlueprintPayload(BaseModel):
    nodes: list[BlueprintNodePayload] = []
    edges: list[MappingEdgePayload] = []


class AnalysisOut(BaseModel):
    evidences: list[EvidenceItem]
    questions: list[AssistantQuestionOut]
    blueprint: BlueprintPayload
    summary: dict[str, Any]


class ValidationIssue(BaseModel):
    severity: Literal["error", "warning", "info"]
    message: str
    row: int | None = None
    column: str | None = None
    rule: str = "structural"
    suggested_fix: str = ""


class ValidationOut(BaseModel):
    id: str
    status: str
    issues: list[ValidationIssue]
    summary: dict[str, Any]


class ExportOut(BaseModel):
    id: str
    export_type: str
    path: str
    payload: dict[str, Any]

    model_config = {"from_attributes": True}


class JobOut(BaseModel):
    id: str
    project_id: str
    kind: str
    status: str
    result: dict[str, Any]
    error: str

    model_config = {"from_attributes": True}
