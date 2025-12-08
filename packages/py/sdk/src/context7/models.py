"""Pydantic models for Context7 API request/response types."""

from __future__ import annotations

from enum import Enum
from typing import Literal, Union

from pydantic import BaseModel, ConfigDict, Field


class LibraryState(str, Enum):
    """State of a library in the Context7 system."""

    INITIAL = "initial"
    FINALIZED = "finalized"
    PROCESSING = "processing"
    ERROR = "error"
    DELETE = "delete"


class AuthenticationType(str, Enum):
    """Type of authentication used for the API request."""

    NONE = "none"
    PERSONAL = "personal"
    TEAM = "team"


class SearchResult(BaseModel):
    """A single library search result."""

    id: str
    title: str
    description: str
    branch: str
    last_update_date: str = Field(alias="lastUpdateDate")
    state: LibraryState
    total_tokens: int = Field(alias="totalTokens")
    total_snippets: int = Field(alias="totalSnippets")
    stars: int | None = None
    trust_score: float | None = Field(default=None, alias="trustScore")
    benchmark_score: float | None = Field(default=None, alias="benchmarkScore")
    versions: list[str] | None = None

    model_config = ConfigDict(validate_by_name=True, validate_by_alias=True)


class APIResponseMetadata(BaseModel):
    """Metadata about the API response."""

    authentication: AuthenticationType


class SearchLibraryResponse(BaseModel):
    """Response from the search library endpoint."""

    results: list[SearchResult]
    metadata: APIResponseMetadata


class CodeExample(BaseModel):
    """A code example in a specific language."""

    language: str
    code: str


class CodeSnippet(BaseModel):
    """A code snippet from the documentation."""

    code_title: str = Field(alias="codeTitle")
    code_description: str = Field(alias="codeDescription")
    code_language: str = Field(alias="codeLanguage")
    code_tokens: int = Field(alias="codeTokens")
    code_id: str = Field(alias="codeId")
    page_title: str = Field(alias="pageTitle")
    code_list: list[CodeExample] = Field(alias="codeList")

    model_config = ConfigDict(validate_by_name=True, validate_by_alias=True)


class InfoSnippet(BaseModel):
    """An information snippet from the documentation."""

    page_id: str | None = Field(default=None, alias="pageId")
    breadcrumb: str | None = None
    content: str
    content_tokens: int = Field(alias="contentTokens")

    model_config = ConfigDict(validate_by_name=True, validate_by_alias=True)


class Pagination(BaseModel):
    """Pagination information for paginated responses."""

    page: int
    limit: int
    total_pages: int = Field(alias="totalPages")
    has_next: bool = Field(alias="hasNext")
    has_prev: bool = Field(alias="hasPrev")

    model_config = ConfigDict(validate_by_name=True, validate_by_alias=True)


class DocsResponseBase(BaseModel):
    """Base class for documentation responses."""

    pagination: Pagination
    total_tokens: int = Field(alias="totalTokens")

    model_config = ConfigDict(validate_by_name=True, validate_by_alias=True)


class CodeDocsResponse(DocsResponseBase):
    """Response containing code documentation snippets."""

    snippets: list[CodeSnippet]


class InfoDocsResponse(DocsResponseBase):
    """Response containing information documentation snippets."""

    snippets: list[InfoSnippet]


class TextDocsResponse(DocsResponseBase):
    """Response containing plain text documentation."""

    content: str


class GetDocsOptions(BaseModel):
    """Options for fetching documentation."""

    version: str | None = None
    """Library version to fetch docs for (e.g., "18.0.0")."""

    page: int | None = None
    """Page number for pagination."""

    topic: str | None = None
    """Filter docs by topic."""

    limit: int | None = None
    """Number of results per page."""

    mode: Literal["info", "code"] = "code"
    """Type of documentation to fetch. Defaults to "code"."""

    format: Literal["json", "txt"] = "json"
    """Response format. Defaults to "json"."""


DocsResponse = Union[CodeDocsResponse, InfoDocsResponse, TextDocsResponse]
