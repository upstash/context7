"""
Context7 Python SDK - Documentation retrieval for AI agents.

This SDK provides a simple interface to search for libraries and retrieve
documentation from Context7, optimized for AI agents and LLMs.

Example:
    ```python
    import asyncio
    from context7 import Context7

    async def main():
        async with Context7(api_key="ctx7sk_...") as client:
            # Search for libraries
            libraries = await client.search_library_async(
                "I need a UI library", "react"
            )

            # Get documentation context
            context = await client.get_context_async(
                "How to use hooks", "/facebook/react"
            )
            print(context)

    asyncio.run(main())
    ```
"""

from context7.client import Context7
from context7.errors import Context7APIError, Context7Error
from context7.models import Documentation, Library

__all__ = [
    "Context7",
    "Context7Error",
    "Context7APIError",
    "Library",
    "Documentation",
]

__version__ = "0.1.0"
