"""Versioned, evidence-first professional research reports.

The package is intentionally isolated from the legacy fast-analysis service so
the new contract can be rolled out without breaking existing API consumers.
"""

from .builder import build_professional_report

__all__ = ["build_professional_report"]
