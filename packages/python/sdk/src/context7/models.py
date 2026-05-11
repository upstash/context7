"""Pydantic models for Context7 API request/response types."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class Library(BaseModel):
    """A library available in Context7."""

    id: str
    """Context7 library ID (e.g., "/facebook/react")"""

    name: str
    """Library display name"""

    description: str
    """Library description"""

    total_snippets: int = Field(default=0)
    """Number of documentation snippets available"""

    trust_score: float = Field(default=0.0)
    """Source reputation score (0-10)"""

    benchmark_score: float = Field(default=0.0)
    """Quality indicator score (0-100)"""

    versions: list[str] | None = None
    """Available versions/tags"""


class Documentation(BaseModel):
    """A piece of documentation content."""

    title: str
    """Title of the documentation snippet"""

    content: str
    """The documentation content (may include code blocks in markdown format)"""

    source: str
    """Source URL or identifier for the snippet"""


class ApiCodeSnippet(BaseModel):
    """Internal: A code snippet from the API response."""

    code_title: str = Field(alias="codeTitle")
    code_description: str = Field(alias="codeDescription")
    code_language: str = Field(alias="codeLanguage")
    code_list: list[dict[str, str]] = Field(alias="codeList")
    code_id: str = Field(alias="codeId")
    code_tokens: int | None = Field(default=None, alias="codeTokens")
    page_title: str | None = Field(default=None, alias="pageTitle")

    model_config = ConfigDict(populate_by_name=True)


class ApiInfoSnippet(BaseModel):
    """Internal: An info snippet from the API response."""

    content: str
    breadcrumb: str | None = None
    page_id: str = Field(alias="pageId")
    content_tokens: int | None = Field(default=None, alias="contentTokens")

    model_config = ConfigDict(populate_by_name=True)


class ApiContextJsonResponse(BaseModel):
    """Internal: JSON response from the context API."""

    code_snippets: list[ApiCodeSnippet] = Field(alias="codeSnippets")
    info_snippets: list[ApiInfoSnippet] = Field(alias="infoSnippets")

    model_config = ConfigDict(populate_by_name=True)


class ApiSearchResult(BaseModel):
    """Internal: A search result from the API response."""

    id: str
    title: str
    description: str
    versions: list[str] | None = None
    total_snippets: int | None = Field(default=None, alias="totalSnippets")
    trust_score: float | None = Field(default=None, alias="trustScore")
    benchmark_score: float | None = Field(default=None, alias="benchmarkScore")

    model_config = ConfigDict(populate_by_name=True)
