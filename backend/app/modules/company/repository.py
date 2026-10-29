"""Import source snapshots atomically; serve company searches only from PostgreSQL."""

import asyncio
import json

import structlog
from sqlalchemy import Text, any_, bindparam, case, cast, func, or_, select, text, update
from sqlalchemy.dialects.postgresql import ARRAY, insert
from sqlalchemy.exc import SQLAlchemyError

from app.core.database import Database
from app.modules.company.catalog import (
    INDUSTRY_ROOTS,
    CatalogUnavailable,
    Company,
    CompanyCatalog,
    Industry,
)
from app.modules.company.models import CompanyImport, CompanyRecord
from app.modules.company.profiles import ProfileError

IMPORT_LOCK = 7364201101


def normalize(value: str) -> str:
    return "".join(value.split()).casefold()


class CompanyRepository:
    def __init__(self, database: Database, source: CompanyCatalog):
        self.database = database
        self.source = source
        self.ready = False
        self._lock = asyncio.Lock()

    def signature(self) -> str:
        paths = (
            self.source.path,
            self.source.profiles.store.pointer,
            self.source.profiles.seed,
            self.source.profiles.codes_path,
        )
        return json.dumps(
            [
                [str(path), path.stat().st_mtime_ns, path.stat().st_size]
                if path.exists()
                else [str(path), None, None]
                for path in paths
            ]
        )

    def source_rows(self) -> list[dict]:
        companies = self.source.load()
        with self.source._profiles_lock:
            self.source.profiles.load()
            ksic = self.source.profiles.ksic
            groups = {}
            if ksic:
                for code in ksic.codes:
                    ancestor = code
                    while ancestor:
                        group = next(
                            (name for name, root in INDUSTRY_ROOTS.items() if root == ancestor),
                            None,
                        )
                        if group:
                            groups[code] = group
                            break
                        ancestor = ksic.codes[ancestor]["parent"]
            rows = []
            for company in companies:
                fields = self.source.profiles.fields(company.corp_code)
                rows.append(
                    company.model_dump()
                    | fields
                    | {
                        "industry": groups.get(fields["ksic11_code"])
                        if fields["ksic11_status"] == "matched"
                        else None,
                        "search_name": normalize(company.corp_name),
                        "search_eng_name": normalize(company.corp_eng_name or ""),
                        "active": True,
                    }
                )
            return rows

    async def import_sources(self, *, refresh: bool = False) -> bool:
        async with self._lock, self.database.transaction() as session:
            # Serialize API importers; failures roll back rows and the checkpoint together.
            await session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": IMPORT_LOCK})
            checkpoint = await session.get(CompanyImport, 1)
            if checkpoint and not refresh:
                self.ready = True
                return False
            signature = self.signature()
            if checkpoint and checkpoint.source_signature == signature:
                self.ready = True
                return False
            try:
                rows = await asyncio.to_thread(self.source_rows)
            except ProfileError:
                raise CatalogUnavailable("company_profiles_unavailable") from None
            current_signature = self.signature()
            # Only creating a previously missing ZIP is allowed during the source read.
            before, after = json.loads(signature), json.loads(current_signature)
            if before[1:] != after[1:] or (before[0][1] is not None and before[0] != after[0]):
                raise CatalogUnavailable("company_sources_changed_during_import")
            await session.execute(
                update(CompanyRecord)
                .where(
                    CompanyRecord.active.is_(True),
                    ~(CompanyRecord.corp_code == any_(cast(bindparam("codes"), ARRAY(Text)))),
                )
                .values(active=False),
                {"codes": [row["corp_code"] for row in rows]},
                execution_options={"synchronize_session": False},
            )
            statement = insert(CompanyRecord.__table__)
            upsert = statement.on_conflict_do_update(
                index_elements=[CompanyRecord.corp_code],
                set_={
                    column.name: statement.excluded[column.name]
                    for column in CompanyRecord.__table__.columns
                    if column.name != "corp_code"
                },
                where=or_(
                    *(
                        column.is_distinct_from(statement.excluded[column.name])
                        for column in CompanyRecord.__table__.columns
                        if column.name != "corp_code"
                    )
                ),
            )
            for start in range(0, len(rows), 1000):
                await session.execute(upsert, rows[start : start + 1000])
            statement = insert(CompanyImport).values(
                id=1,
                source_signature=current_signature,
                company_count=len(rows),
            )
            await session.execute(
                statement.on_conflict_do_update(
                    index_elements=[CompanyImport.id],
                    set_={
                        "source_signature": statement.excluded.source_signature,
                        "company_count": statement.excluded.company_count,
                        "imported_at": func.now(),
                    },
                )
            )
        self.ready = True
        structlog.get_logger().info("company_database_imported", companies=len(rows))
        return True

    async def search(
        self,
        query: str,
        offset: int,
        limit: int,
        industry: Industry | None = None,
        market: str | None = None,
    ) -> dict:
        if not self.ready:
            await self.import_sources()
        needle = normalize(query)
        conditions = [CompanyRecord.active.is_(True)]
        order = []
        if needle:
            fields = (
                CompanyRecord.search_name,
                CompanyRecord.search_eng_name,
                CompanyRecord.corp_code,
                func.lower(CompanyRecord.stock_code),
            )
            conditions.append(or_(*(field.contains(needle, autoescape=True) for field in fields)))
            order.append(
                case(
                    (
                        or_(
                            CompanyRecord.search_name == needle,
                            CompanyRecord.corp_code == needle,
                            func.lower(CompanyRecord.stock_code) == needle,
                        ),
                        0,
                    ),
                    else_=1,
                )
            )
        if industry:
            conditions.append(CompanyRecord.industry == industry)
        if market:
            conditions.append(CompanyRecord.corp_cls == market)
        async with self.database.transaction() as session:
            # Keep count/page on one MVCC snapshot during a concurrent import.
            await session.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"))
            total = await session.scalar(
                select(func.count()).select_from(CompanyRecord).where(*conditions)
            )
            records = (
                await session.scalars(
                    select(CompanyRecord)
                    .where(*conditions)
                    .order_by(*order, CompanyRecord.corp_name, CompanyRecord.corp_code)
                    .offset(offset)
                    .limit(limit)
                )
            ).all()
            items = [Company.model_validate(record, from_attributes=True) for record in records]
        return {"items": items, "total": total, "offset": offset, "limit": limit}


async def run_imports(repository: CompanyRepository):
    while True:
        try:
            await repository.import_sources(refresh=repository.ready)
        except (CatalogUnavailable, ProfileError, SQLAlchemyError, OSError, ValueError):
            structlog.get_logger().warning("company_database_import_failed")
        await asyncio.sleep(60)
