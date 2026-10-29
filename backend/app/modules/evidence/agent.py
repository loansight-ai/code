"""Application-owned search scope, budgets, provenance and output validation."""

import asyncio
import json
from uuid import uuid4

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select, text

from app.integrations.agents.gateway import configured, runtime_for
from app.integrations.agents.runtime import AgentError
from app.modules.evidence.agent_schemas import AgentOutput
from app.modules.evidence.models import NoteAgentRun
from app.modules.evidence.search import TOOL_VERSION, NoteSearchTools
from app.modules.evidence.search_baseline import CATEGORIES, DICTIONARY_VERSION, run_baseline
from app.modules.evidence.service import fingerprint
from app.modules.identity.service import Identity
from app.modules.tasks import service as tasks
from app.modules.tasks.models import Job, Outbox, UserTask

PROMPT_VERSION = "note-agent-v1"
OUTPUT_VERSION = "note-findings-v1"


def definitions():
    tools = NoteSearchTools.definitions()
    for tool in tools:
        schema = tool["parameters"]
        schema["properties"]["category_key"] = {
            "type": "string",
            "enum": [c[0] for c in CATEGORIES],
            "description": "현재 탐색하는 공통 주석 항목",
        }
        schema.setdefault("required", []).append("category_key")
    return tools


async def latest(db, identity, structure_id):
    await NoteSearchTools.owned(db, identity, structure_id)
    row = (
        await db.execute(
            select(NoteAgentRun, Job)
            .join(Job, Job.id == NoteAgentRun.job_id)
            .where(
                NoteAgentRun.workspace_id == identity.workspace_id,
                NoteAgentRun.structure_id == structure_id,
            )
            .order_by(NoteAgentRun.created_at.desc(), NoteAgentRun.id.desc())
            .limit(1)
        )
    ).first()
    if row is None:
        return None
    run, job = row
    return {
        "run_id": str(run.id),
        "structure_id": str(run.structure_id),
        "status": job.status,
        "error_code": job.error_code,
        "result": job.result,
        "created_at": run.created_at.isoformat(),
    }


async def submit(database, settings, identity, structure_id):
    async with database.transaction() as db:
        tools = await NoteSearchTools.owned(db, identity, structure_id)
        if not configured(settings) or settings.job_max_attempts is None:
            raise HTTPException(503, "note_agent_not_configured")
        config = {
            "provider": settings.note_agent_provider,
            "model": settings.note_agent_model,
            "prompt_version": PROMPT_VERSION,
            "output_version": OUTPUT_VERSION,
            "tool_version": TOOL_VERSION,
            "dictionary_version": DICTIONARY_VERSION,
            "timeout_seconds": settings.note_agent_timeout_seconds,
            "max_tool_calls": settings.note_agent_max_tool_calls,
        }
        key = fingerprint({"workspace": str(identity.workspace_id), **tools.provenance(), **config})
        await db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": int(key[:15], 16)})
        row = (
            await db.execute(
                select(NoteAgentRun, Job)
                .join(Job, Job.id == NoteAgentRun.job_id)
                .where(NoteAgentRun.config_key == key)
                .order_by(NoteAgentRun.created_at.desc())
                .limit(1)
            )
        ).first()
        reused = row is not None and row[1].status not in {"FAILED", "PARTIAL_SUCCEEDED"}
        if reused:
            run, job = row
            task = await db.scalar(select(UserTask).where(UserTask.job_id == job.id))
        else:
            # Failed/incomplete runs can be explicitly retried, never auto-billed in a loop.
            job = Job(
                fingerprint=fingerprint({"config": key, "request": str(uuid4())}),
                task_type="NOTE_AGENT",
            )
            db.add(job)
            await db.flush()
            run = NoteAgentRun(
                workspace_id=identity.workspace_id,
                structure_id=structure_id,
                job_id=job.id,
                config_key=key,
                config=config,
            )
            task = UserTask(workspace_id=identity.workspace_id, job_id=job.id)
            db.add_all([run, task, Outbox(job_id=job.id, generation=job.generation)])
            await db.flush()
            await tasks.emit(db, job, "task.created", [task])
        return {**tasks.task_payload(task, job), "run_id": str(run.id), "reused": reused}


async def prepare(database, settings, job_id):
    async with database.transaction() as db:
        run = await db.scalar(select(NoteAgentRun).where(NoteAgentRun.job_id == job_id))
        if run is None:
            raise AgentError("note_agent_run_missing")
        # Identity is server-owned; no session token or code is sent to the runtime.
        identity = Identity(uuid4(), uuid4(), run.workspace_id, "")
        config, structure_id = run.config, run.structure_id
        baseline = await run_baseline(db, identity, structure_id)
    trace, reads, seen, searched = [], set(), set(), set()

    async def call(name, arguments):
        if len(trace) >= config["max_tool_calls"]:
            raise AgentError("note_agent_tool_budget_exhausted")
        arguments = dict(arguments)
        category = arguments.pop("category_key", None)
        signature = fingerprint({"name": name, "category": category, "arguments": arguments})
        if signature in seen:
            raise AgentError("note_agent_repeated_tool_call")
        seen.add(signature)
        entry = {
            "tool": name,
            "category_key": category,
            "arguments": arguments,
            "status": "STARTED",
        }
        trace.append(entry)
        try:
            if category not in {c[0] for c in CATEGORIES}:
                raise ValueError("category_required")
            async with database.transaction() as db:
                tools = await NoteSearchTools.owned(db, identity, structure_id)
                result = await tools.call(name, arguments)
            if name == "read_note_context":
                # Citation validation also checks source membership and exact text below.
                reads.update((category, s["segment_id"]) for s in result["segments"])
            if name == "search_note_segments":
                searched.add(category)
            entry["status"] = "COMPLETED"
            entry["result"] = result
            return result
        except (HTTPException, ValueError, ValidationError):
            entry["status"] = "FAILED"
            return {"error": "note_tool_arguments_or_scope_invalid"}

    result = {
        "kind": "NOTE_AGENT",
        "run_id": str(run.id),
        **{k: v for k, v in baseline.items() if k not in {"run_id", "items", "created_at"}},
        "execution_kind": "AGENT_SEARCH",
        "execution_status": "INCOMPLETE",
        "agent_status": "INCOMPLETE",
        "review_status": "PENDING",
        "config": config,
        "trace": trace,
        "items": [
            {
                "key": c[0],
                "search_status": "INCOMPLETE",
                "findings": [],
                "limitations": "보완 탐색 미완료. 기본 검색과 미확보 영역을 확인해야 합니다.",
            }
            for c in CATEGORIES
        ],
    }
    prompt = (
        "공통 6항목을 모두 보완 탐색하라. 각 항목의 검색과 문맥 조회를 수행하고 "
        "명시적 부정문도 보존하라. 미확보 영역과 미검수를 한계에 표시하라. "
        "기본 검색은 이미 완료되었다. 제한 안에 확인하지 못한 항목은 INCOMPLETE로 반환하라.\n"
        + json.dumps(
            {"baseline": baseline, "max_tool_calls": config["max_tool_calls"]}, ensure_ascii=False
        )
    )
    try:
        async with asyncio.timeout(config["timeout_seconds"]):
            response = await runtime_for(config, settings).run(
                prompt, definitions(), call, AgentOutput.model_json_schema()
            )
            output = AgentOutput.model_validate_json(response.text)
            if {i.key for i in output.items} != {c[0] for c in CATEGORIES}:
                raise AgentError("note_agent_categories_missing")
            citations = [c for item in output.items for f in item.findings for c in f.citations]
            if any(
                (i.key, str(c.segment_id)) not in reads
                for i in output.items
                for f in i.findings
                for c in f.citations
            ):
                raise AgentError("note_agent_unread_citation")
            for item in output.items:
                failed = any(
                    t["category_key"] == item.key and t["status"] == "FAILED" for t in trace
                )
                if item.key not in searched or failed:
                    item.search_status = "INCOMPLETE"
            async with database.transaction() as db:
                tools = await NoteSearchTools.owned(db, identity, structure_id)
                for citation in citations:
                    await tools.validate_citations([citation])
            result.update(
                {
                    "model": response.model,
                    "thread_id": response.thread_id,
                    "items": output.model_dump(mode="json")["items"],
                }
            )
            complete = all(i.search_status == "COMPLETED" for i in output.items)
            result["execution_status"] = result["agent_status"] = (
                "COMPLETED" if complete else "INCOMPLETE"
            )
            result["stop_reason"] = None if complete else "note_agent_partial_coverage"
    except TimeoutError:
        result["stop_reason"] = "note_agent_timeout"
    except AgentError as error:
        result["stop_reason"] = error.code
    except (ValidationError, HTTPException):
        result["stop_reason"] = "note_agent_output_invalid"
    except (OSError, ConnectionError):
        result["stop_reason"] = "codex_connection_failed"
    return result
