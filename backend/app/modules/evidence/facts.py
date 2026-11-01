"""Owned fact revisions, opening receipts and optimistic audited review decisions."""

from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import select, text

from app.modules.evidence.bundle_tools import BundleTools
from app.modules.evidence.fact_models import EvidenceFact, FactOpening, FactReview
from app.modules.evidence.fact_schemas import FactInput
from app.modules.evidence.fact_sources import page, resolve
from app.modules.evidence.fact_validation import normalize, validate
from app.modules.evidence.service import fingerprint


def keys(data, validation):
    comparable = {
        k: data[k]
        for k in (
            "category",
            "kind",
            "subject",
            "direction",
            "period",
            "counterparty",
            "amount_role",
            "maturity",
        )
    }
    comparable = {k: normalize(v) if isinstance(v, str) else v for k, v in comparable.items()}
    return fingerprint(comparable), fingerprint(
        {
            "amount": validation["normalized_amount"],
            "currency": (data.get("amount") or {}).get("currency"),
            "status": data["status"],
            "detection": data["detection"],
            "statement": normalize(data["statement"])
            if not data.get("amount") and not data.get("status")
            else None,
        }
    )


async def owned_fact(db, identity, bundle_id, fact_id, lock=False):
    tools = await BundleTools.owned(db, identity, bundle_id)
    query = select(EvidenceFact).where(
        EvidenceFact.id == fact_id, EvidenceFact.bundle_id == bundle_id
    )
    fact = await db.scalar(query.with_for_update() if lock else query)
    if fact is None:
        raise HTTPException(404, "evidence_fact_not_found")
    return tools, fact


def payload(fact):
    return {
        "id": str(fact.id),
        "bundle_id": str(fact.bundle_id),
        "root_id": str(fact.root_id),
        "supersedes_id": str(fact.supersedes_id) if fact.supersedes_id else None,
        "revision": fact.revision,
        "version": fact.version,
        "state": fact.state,
        "data": fact.data,
        "validation": fact.validation,
        "origin": fact.origin,
        "comparison_key": fact.comparison_key,
        "value_key": fact.value_key,
        "created_at": fact.created_at.isoformat(),
        "model_eligible": False,
        "withholding_reason": "MODEL_AND_POINT_IN_TIME_CONTRACT_PENDING",
    }


async def add(db, tools, candidate, origin, parent=None):
    data = candidate.model_dump(mode="json")
    validation = await validate(tools, candidate)
    key = fingerprint(
        {"bundle": str(tools.bundle.id), "data": data, "parent": str(parent.id) if parent else None}
    )
    await db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": int(key[:15], 16)})
    existing = await db.scalar(select(EvidenceFact).where(EvidenceFact.fingerprint == key))
    if existing:
        return existing
    fid = uuid4()
    comparison, value = keys(data, validation)
    row = EvidenceFact(
        id=fid,
        bundle_id=tools.bundle.id,
        root_id=parent.root_id if parent else fid,
        supersedes_id=parent.id if parent else None,
        revision=parent.revision + 1 if parent else 1,
        fingerprint=key,
        comparison_key=comparison,
        value_key=value,
        data=data,
        validation=validation,
        origin=origin,
        state="PENDING",
        version=0,
    )
    db.add(row)
    await db.flush()
    return row


async def list_facts(db, identity, bundle_id, offset=0, limit=30):
    await BundleTools.owned(db, identity, bundle_id)
    rows = list(
        (
            await db.scalars(
                select(EvidenceFact)
                .where(EvidenceFact.bundle_id == bundle_id)
                .order_by(EvidenceFact.created_at, EvidenceFact.id)
                .offset(offset)
                .limit(limit + 1)
            )
        ).all()
    )
    selected = rows[:limit]
    related = (
        list(
            (
                await db.scalars(
                    select(EvidenceFact).where(
                        EvidenceFact.bundle_id == bundle_id,
                        EvidenceFact.comparison_key.in_({r.comparison_key for r in selected}),
                        EvidenceFact.state.in_(["PENDING", "APPROVED"]),
                    )
                )
            ).all()
        )
        if selected
        else []
    )
    return {
        "bundle_id": str(bundle_id),
        "facts": [
            {
                **payload(r),
                "related": [
                    {
                        "id": str(other.id),
                        "state": other.state,
                        "relation": "SAME_FIELDS"
                        if other.value_key == r.value_key
                        else "POSSIBLE_CONFLICT",
                    }
                    for other in related
                    if other.id != r.id and other.comparison_key == r.comparison_key
                ],
            }
            for r in selected
        ],
        "next_offset": offset + limit if len(rows) > limit else None,
    }


async def history(db, identity, bundle_id, fact_id):
    _, fact = await owned_fact(db, identity, bundle_id, fact_id)
    rows = (
        await db.scalars(
            select(FactReview).where(FactReview.fact_id == fact.id).order_by(FactReview.version)
        )
    ).all()
    versions = (
        await db.scalars(
            select(EvidenceFact)
            .where(EvidenceFact.bundle_id == bundle_id, EvidenceFact.root_id == fact.root_id)
            .order_by(EvidenceFact.revision)
        )
    ).all()
    return {
        "fact": payload(fact),
        "revisions": [
            {"id": str(v.id), "revision": v.revision, "state": v.state} for v in versions
        ],
        "reviews": [
            {
                "id": str(r.id),
                "decision": r.decision,
                "reason": r.reason,
                "before_state": r.before_state,
                "after_state": r.after_state,
                "version": r.version,
                "reviewer_id": str(r.reviewer_id),
                "created_at": r.created_at.isoformat(),
            }
            for r in rows
        ],
    }


async def opening(db, identity, bundle_id, fact_id):
    tools, fact = await owned_fact(db, identity, bundle_id, fact_id)
    current = await validate(tools, FactInput.model_validate(fact.data))
    contexts, seen = [], set()
    for cite in fact.data["citations"]:
        sid = cite["segment_id"]
        if sid in seen:
            continue
        seen.add(sid)
        source = await resolve(tools, UUID(sid))
        amount = fact.data.get("amount")
        row = amount["cell"]["row"] if amount and amount["cell"]["segment_id"] == sid else 0
        position = source["text"].find(cite["quote"])
        contexts.append(
            {
                **page(source, max(0, row - 2), max(0, position - 200)),
                "citations": [c for c in fact.data["citations"] if c["segment_id"] == sid],
            }
        )
    receipt = FactOpening(
        fact_id=fact.id,
        user_id=identity.user_id,
        fact_version=fact.version,
        source_digest=current["source_digest"] or "invalid",
    )
    db.add(receipt)
    await db.flush()
    return {
        "opening_id": str(receipt.id),
        "fact": payload(fact),
        "current_validation": current,
        "contexts": contexts,
        "approved_automatically": False,
    }


async def revise(db, identity, bundle_id, fact_id, body):
    tools, old = await owned_fact(db, identity, bundle_id, fact_id, lock=True)
    if old.version != body.expected_version or old.state == "SUPERSEDED":
        raise HTTPException(409, "fact_version_conflict")
    if body.fact.model_dump(mode="json") == old.data or not body.reason.strip():
        raise HTTPException(422, "fact_revision_requires_change_and_reason")
    new = await add(
        db, tools, body.fact, {"kind": "HUMAN_REVISION", "user_id": str(identity.user_id)}, old
    )
    before = old.state
    old.state, old.version = "SUPERSEDED", old.version + 1
    db.add(
        FactReview(
            fact_id=old.id,
            request_id=uuid4(),
            reviewer_id=identity.user_id,
            opening_id=None,
            decision="SUPERSEDE",
            reason=body.reason,
            before_state=before,
            after_state=old.state,
            version=old.version,
        )
    )
    return payload(new)


async def review(db, identity, bundle_id, fact_id, body):
    tools = await BundleTools.owned(db, identity, bundle_id)
    # Serialize decisions and revisions within a bundle, including conflicting approvals.
    await db.execute(
        text("SELECT pg_advisory_xact_lock(:key)"), {"key": int(tools.bundle.fingerprint[:15], 16)}
    )
    _, fact = await owned_fact(db, identity, bundle_id, fact_id, lock=True)
    prior = await db.scalar(
        select(FactReview).where(
            FactReview.fact_id == fact.id, FactReview.request_id == body.request_id
        )
    )
    if prior:
        if (
            prior.reviewer_id != identity.user_id
            or prior.decision != body.decision
            or prior.reason != body.reason
            or prior.version != body.expected_version + 1
            or prior.opening_id != (body.opening_id if body.decision == "APPROVE" else None)
        ):
            raise HTTPException(409, "review_request_reused")
        return {"fact": payload(fact), "reused": True}
    if fact.version != body.expected_version or fact.state == "SUPERSEDED":
        raise HTTPException(409, "fact_version_conflict")
    if not body.reason.strip():
        raise HTTPException(422, "review_reason_required")
    target = {"APPROVE": "APPROVED", "REJECT": "REJECTED", "REOPEN": "PENDING"}[body.decision]
    if target == fact.state:
        raise HTTPException(409, "fact_already_in_state")
    if body.decision == "APPROVE":
        current = await validate(tools, FactInput.model_validate(fact.data))
        if current["status"] != "CITATIONS_VALID":
            raise HTTPException(422, "fact_validation_blocked")
        if current["source_digest"] != fact.validation["source_digest"]:
            raise HTTPException(409, "fact_source_changed")
        receipt = await db.get(FactOpening, body.opening_id) if body.opening_id else None
        if (
            not receipt
            or receipt.fact_id != fact.id
            or receipt.user_id != identity.user_id
            or receipt.fact_version != fact.version
            or receipt.source_digest != current["source_digest"]
        ):
            raise HTTPException(409, "fact_evidence_must_be_opened")
        conflicts = await db.scalar(
            select(EvidenceFact.id)
            .where(
                EvidenceFact.bundle_id == bundle_id,
                EvidenceFact.id != fact.id,
                EvidenceFact.comparison_key == fact.comparison_key,
                EvidenceFact.value_key != fact.value_key,
                EvidenceFact.state == "APPROVED",
            )
            .limit(1)
        )
        if conflicts:
            raise HTTPException(409, "approved_fact_conflict")
    before = fact.state
    fact.state, fact.version = target, fact.version + 1
    db.add(
        FactReview(
            fact_id=fact.id,
            request_id=body.request_id,
            reviewer_id=identity.user_id,
            opening_id=body.opening_id if body.decision == "APPROVE" else None,
            decision=body.decision,
            reason=body.reason,
            before_state=before,
            after_state=target,
            version=fact.version,
        )
    )
    return {"fact": payload(fact), "reused": False}
