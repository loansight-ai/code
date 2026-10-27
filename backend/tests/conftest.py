import asyncio
import sys

# Psycopg's async driver requires the selector loop on Windows.
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
