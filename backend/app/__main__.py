"""Uvicorn CLI with the event loop required by Psycopg on Windows."""

import asyncio
import sys

from uvicorn.main import main

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

if __name__ == "__main__":
    main()
