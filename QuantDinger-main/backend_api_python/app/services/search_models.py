import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from itertools import cycle
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from app.utils.logger import get_logger

logger = get_logger(__name__)


@dataclass
class SearchResult:
    """Single search result item."""

    title: str
    snippet: str
    url: str
    source: str
    published_date: Optional[str] = None
    sentiment: str = "neutral"

    def to_text(self) -> str:
        """Render the result as compact text for AI context."""
        date_str = f" ({self.published_date})" if self.published_date else ""
        return f"[{self.source}] {self.title}{date_str}\n{self.snippet}"

    def to_dict(self) -> Dict[str, Any]:
        """Convert to the legacy API dictionary shape."""
        return {
            "title": self.title,
            "link": self.url,
            "snippet": self.snippet,
            "source": self.source,
            "published": self.published_date or "",
            "sentiment": self.sentiment,
        }


@dataclass
class SearchResponse:
    """Search response returned by providers."""

    query: str
    results: List[SearchResult]
    provider: str
    success: bool = True
    error_message: Optional[str] = None
    search_time: float = 0.0

    def to_context(self, max_results: int = 5) -> str:
        """Render search results as context for AI analysis."""
        if not self.success or not self.results:
            return f"No relevant results found for '{self.query}'."

        lines = [f"[{self.query} search results] source: {self.provider}"]
        for index, result in enumerate(self.results[:max_results], 1):
            lines.append(f"\n{index}. {result.to_text()}")
        return "\n".join(lines)

    def to_list(self) -> List[Dict[str, Any]]:
        """Convert to the legacy list shape."""
        return [result.to_dict() for result in self.results]


class BaseSearchProvider(ABC):
    """Base class for search providers with key rotation and fallback state."""

    def __init__(self, api_keys: List[str], name: str):
        self._api_keys = api_keys
        self._name = name
        self._key_cycle = cycle(api_keys) if api_keys else None
        self._key_usage: Dict[str, int] = {key: 0 for key in api_keys}
        self._key_errors: Dict[str, int] = {key: 0 for key in api_keys}

    @property
    def name(self) -> str:
        return self._name

    @property
    def is_available(self) -> bool:
        """Return whether this provider has any usable API key."""
        return bool(self._api_keys)

    def _get_next_key(self) -> Optional[str]:
        """Return the next key, skipping keys with repeated failures."""
        if not self._key_cycle:
            return None

        for _ in range(len(self._api_keys)):
            key = next(self._key_cycle)
            if self._key_errors.get(key, 0) < 3:
                return key

        logger.warning("[%s] all API keys have failures; resetting error counters", self._name)
        self._key_errors = {key: 0 for key in self._api_keys}
        return self._api_keys[0] if self._api_keys else None

    def _record_success(self, key: str) -> None:
        """Record a successful key usage."""
        self._key_usage[key] = self._key_usage.get(key, 0) + 1
        if key in self._key_errors and self._key_errors[key] > 0:
            self._key_errors[key] -= 1

    def _record_error(self, key: str) -> None:
        """Record a failed key usage."""
        self._key_errors[key] = self._key_errors.get(key, 0) + 1
        logger.warning("[%s] API key %s... error count: %s", self._name, key[:8], self._key_errors[key])

    @abstractmethod
    def _do_search(self, query: str, api_key: str, max_results: int, days: int = 7) -> SearchResponse:
        """Run the provider-specific search request."""
        raise NotImplementedError

    def search(self, query: str, max_results: int = 5, days: int = 7) -> SearchResponse:
        """Run a search through this provider."""
        api_key = self._get_next_key()
        if not api_key:
            return SearchResponse(
                query=query,
                results=[],
                provider=self._name,
                success=False,
                error_message=f"{self._name} is not configured with an API key",
            )

        start_time = time.time()
        try:
            response = self._do_search(query, api_key, max_results, days=days)
            response.search_time = time.time() - start_time
            if response.success:
                self._record_success(api_key)
                logger.info(
                    "[%s] search succeeded for '%s': %s results in %.2fs",
                    self._name,
                    query,
                    len(response.results),
                    response.search_time,
                )
            else:
                self._record_error(api_key)
            return response
        except Exception as exc:
            self._record_error(api_key)
            elapsed = time.time() - start_time
            logger.error("[%s] search failed for '%s': %s", self._name, query, exc)
            return SearchResponse(
                query=query,
                results=[],
                provider=self._name,
                success=False,
                error_message=str(exc),
                search_time=elapsed,
            )

    @staticmethod
    def _extract_domain(url: str) -> str:
        """Extract a compact domain label from a URL."""
        try:
            parsed = urlparse(url)
            domain = parsed.netloc.replace("www.", "")
            return domain or "unknown"
        except Exception:
            return "unknown"
