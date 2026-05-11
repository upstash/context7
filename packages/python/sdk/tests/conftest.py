"""Pytest configuration and fixtures for Context7 SDK tests."""

from pathlib import Path

import pytest
from dotenv import load_dotenv

# Load .env from the python workspace root (packages/python/.env)
# Path: sdk/tests/conftest.py -> sdk/tests -> sdk -> packages/python
env_path = Path(__file__).parent.parent.parent / ".env"
load_dotenv(env_path)


def pytest_configure(config: pytest.Config) -> None:
    """Configure pytest markers."""
    config.addinivalue_line("markers", "asyncio: mark test as an async test")
