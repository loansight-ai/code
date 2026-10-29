import asyncio
import sys

from alembic import context

from app.core.config import Settings
from app.core.database import Base, Database
from app.modules.company import models as company_models  # noqa: F401
from app.modules.evidence import dart_models  # noqa: F401
from app.modules.evidence import models as evidence_models  # noqa: F401
from app.modules.financial import models as financial_models  # noqa: F401
from app.modules.identity import models as identity_models  # noqa: F401
from app.modules.tasks import models as task_models  # noqa: F401

# Import module models above so autogenerate discovers their metadata.
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=Settings().database_url.get_secret_value(),
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    database = Database(Settings())
    try:
        async with database.engine.connect() as connection:
            await connection.run_sync(do_run_migrations)
    finally:
        await database.close()


if context.is_offline_mode():
    run_migrations_offline()
else:
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(run_migrations_online())
