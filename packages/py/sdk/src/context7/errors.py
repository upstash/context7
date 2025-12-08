"""Custom exceptions for the Context7 SDK."""

from __future__ import annotations


class Context7Error(Exception):
    """Base exception for Context7 SDK errors."""

    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


class Context7APIError(Context7Error):
    """Raised when the API returns an error response."""

    def __init__(self, message: str, status_code: int | None = None) -> None:
        self.status_code = status_code
        super().__init__(message)


class Context7ValidationError(Context7Error):
    """Raised when input validation fails."""

    pass
