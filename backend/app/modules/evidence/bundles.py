"""Pin public dump revisions together with explicitly owned HTML structures."""

from uuid import UUID

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, text

from app.modules.company.models import CollectedEventCoverage, CompanyDatasetImport
from app.modules.evidence.bundle_models import EvidenceBundle, EvidenceDataset, EvidenceReport
from app.modules.evidence.models import NoteStructure, SourceArtifact
from app.modules.evidence.service import fingerprint, owned_structure


class BundleInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    corp_code: str = Field(pattern=r"^[0-9]{8}$")
    receipt_no: str = Field(pattern=r"^[0-9]{14}$")
    scope: str = Field(pattern=r"^(OFS|CFS)$")
    report_id: UUID | None = None
    structure_ids: list[UUID] | None = Field(default=None, max_length=5)


async def owned(db, identity, bundle_id):
    bundle = await db.get(EvidenceBundle, bundle_id)
    if bundle is None or bundle.workspace_id != identity.workspace_id:
        raise HTTPException(404, "evidence_bundle_not_found")
    # Recheck every private source, including after session switches.
    for source in bundle.structure_ids:
        revision, artifact, _ = await owned_structure(db, identity, UUID(source["id"]))
        if artifact.sha256 != source["sha256"] or revision.hierarchy is None:
            raise HTTPException(409, "evidence_source_changed")
    return bundle


async def report_catalog(db, corp_code):
    rows = (
        await db.execute(
            select(EvidenceReport, EvidenceDataset)
            .join(EvidenceDataset)
            .where(EvidenceReport.corp_code == corp_code, EvidenceDataset.status == "READY")
            .order_by(
                EvidenceDataset.created_at.desc(),
                EvidenceReport.receipt_no.desc(),
                EvidenceReport.id,
            )
        )
    ).all()
    seen, result = set(), []
    for report, dataset in rows:
        if report.receipt_no in seen:
            continue
        seen.add(report.receipt_no)
        result.append(
            {
                "report_id": str(report.id),
                "receipt_no": report.receipt_no,
                "period": report.period,
                "company_name": report.data.get("corp_name"),
                "scope": "OFS",
                "dataset_id": str(dataset.id),
            }
        )
    return result


async def create(db, identity, body):
    report = None
    if body.scope == "OFS":
        query = (
            select(EvidenceReport)
            .join(EvidenceDataset)
            .where(
                EvidenceReport.corp_code == body.corp_code,
                EvidenceReport.receipt_no == body.receipt_no,
                EvidenceDataset.status == "READY",
            )
        )
        if body.report_id:
            query = query.where(EvidenceReport.id == body.report_id)
        report = await db.scalar(
            query.order_by(EvidenceDataset.created_at.desc(), EvidenceReport.id).limit(1)
        )
    if body.report_id and report is None:
        raise HTTPException(422, "evidence_report_mismatch")
    ids = body.structure_ids
    if ids is None:
        # Only official, owned HTML is automatic. Uploaded claims require explicit selection.
        revision = await db.scalar(
            select(NoteStructure)
            .join(SourceArtifact)
            .where(
                SourceArtifact.workspace_id == identity.workspace_id,
                SourceArtifact.corp_code == body.corp_code,
                SourceArtifact.receipt_no == body.receipt_no,
                SourceArtifact.scope == body.scope,
                SourceArtifact.dart_note_id.is_not(None),
                NoteStructure.hierarchy.is_not(None),
                NoteStructure.completed_at.is_not(None),
            )
            .order_by(NoteStructure.created_at.desc(), NoteStructure.id.desc())
            .limit(1)
        )
        ids = [revision.id] if revision else []
    sources, periods = [], set()
    if report:
        periods.add(report.period)
    for structure_id in sorted(set(ids)):
        revision, artifact, _ = await owned_structure(db, identity, structure_id)
        if (artifact.corp_code, artifact.receipt_no, artifact.scope) != (
            body.corp_code,
            body.receipt_no,
            body.scope,
        ):
            raise HTTPException(422, "evidence_structure_mismatch")
        if revision.hierarchy is None:
            raise HTTPException(409, "note_structure_not_ready")
        periods.add(artifact.period)
        sources.append({"id": str(structure_id), "sha256": artifact.sha256})
    if not report and not sources:
        raise HTTPException(404, "report_evidence_unavailable")
    if len(periods) != 1:
        raise HTTPException(409, "evidence_period_mismatch")
    collection_import_id = await db.scalar(
        select(CompanyDatasetImport.id)
        .join(CollectedEventCoverage)
        .where(CollectedEventCoverage.corp_code == body.corp_code)
        .order_by(
            CompanyDatasetImport.source_as_of.desc(),
            CompanyDatasetImport.imported_at.desc(),
            CompanyDatasetImport.id.desc(),
        )
        .limit(1)
    )
    key = fingerprint(
        {
            "workspace": str(identity.workspace_id),
            "corp": body.corp_code,
            "receipt": body.receipt_no,
            "scope": body.scope,
            "report": str(report.id) if report else None,
            "structures": sources,
            "adapter": "bundle-v1",
            "collection_import_id": str(collection_import_id) if collection_import_id else None,
        }
    )
    await db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": int(key[:15], 16)})
    bundle = await db.scalar(select(EvidenceBundle).where(EvidenceBundle.fingerprint == key))
    if bundle is None:
        bundle = EvidenceBundle(
            workspace_id=identity.workspace_id,
            fingerprint=key,
            corp_code=body.corp_code,
            receipt_no=body.receipt_no,
            scope=body.scope,
            period=periods.pop(),
            report_id=report.id if report else None,
            structure_ids=sources,
            collection_import_id=collection_import_id,
        )
        db.add(bundle)
        await db.flush()
    return bundle
