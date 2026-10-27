FROM ghcr.io/astral-sh/uv:0.13.5 AS uv
FROM python:3.12.15-slim

COPY --from=uv /uv /uvx /bin/
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY pyproject.toml uv.lock .python-version ./
COPY app/modules/dart_note_hierarchy-0.8.4-py3-none-any.whl ./app/modules/
RUN uv sync --frozen --no-dev
COPY app ./app
COPY alembic.ini ./
COPY migrations ./migrations
RUN useradd --create-home --uid 10001 loansight
RUN mkdir -p /data/artifacts && chown loansight:loansight /data/artifacts
USER loansight
EXPOSE 8000
CMD ["/app/.venv/bin/uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
