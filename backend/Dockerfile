FROM ghcr.io/astral-sh/uv:0.13.5 AS uv
FROM node:24.22.1-bookworm-slim AS codex
RUN npm install --global @openai/codex@0.165.0
FROM python:3.12.15-slim

COPY --from=uv /uv /uvx /bin/
COPY --from=codex /usr/local/bin/node /usr/local/bin/node
COPY --from=codex /usr/local/lib/node_modules/@openai /usr/local/lib/node_modules/@openai
RUN ln -s /usr/local/lib/node_modules/@openai/codex/bin/codex.js /usr/local/bin/codex
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY pyproject.toml uv.lock .python-version ./
COPY app/modules/dart_note_hierarchy-0.8.4-py3-none-any.whl ./app/modules/
RUN uv sync --frozen --no-dev
COPY app ./app
COPY data ./data
COPY alembic.ini ./
COPY migrations ./migrations
RUN useradd --create-home --uid 10001 loansight
RUN mkdir -p /data/artifacts && chown loansight:loansight /data/artifacts
RUN mkdir -p /home/loansight/.codex && chown loansight:loansight /home/loansight/.codex
USER loansight
EXPOSE 8000
CMD ["/app/.venv/bin/uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
