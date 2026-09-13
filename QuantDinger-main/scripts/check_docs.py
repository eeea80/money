#!/usr/bin/env python3
"""Validate repository documentation structure and local references."""

from __future__ import annotations

import re
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
ALLOWED_DOCS_ROOT_FILES = {"README.md", "README_CN.md"}
IGNORED_DOCS_ROOT_FILES = {".DS_Store"}
IGNORED_DIRECTORIES = {
    ".git",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".test_deps",
    ".venv",
    "__pycache__",
    "data",
    "logs",
    "node_modules",
}

MARKDOWN_LINK_RE = re.compile(r"(!?)\[[^\]]*\]\(([^)]+)\)")
HTML_LINK_RE = re.compile(
    r"<(a|img|script|link)\b[^>]*?\b(?:href|src)\s*=\s*([\"'])(.*?)\2",
    re.IGNORECASE | re.DOTALL,
)
FENCE_RE = re.compile(r"^\s*(`{3,}|~{3,})")
WINDOWS_ABSOLUTE_RE = re.compile(r"^[A-Za-z]:[\\/]")


def iter_document_files() -> list[Path]:
    files: list[Path] = []
    for path in ROOT.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in {".md", ".html"}:
            continue
        if any(part in IGNORED_DIRECTORIES for part in path.relative_to(ROOT).parts):
            continue
        files.append(path)
    return sorted(files)


def strip_fenced_blocks(text: str) -> str:
    output: list[str] = []
    active_marker: str | None = None
    active_length = 0

    for line in text.splitlines():
        match = FENCE_RE.match(line)
        if match:
            fence = match.group(1)
            marker = fence[0]
            if active_marker is None:
                active_marker = marker
                active_length = len(fence)
            elif marker == active_marker and len(fence) >= active_length:
                active_marker = None
                active_length = 0
            continue
        if active_marker is None:
            output.append(line)

    return "\n".join(output)


def has_balanced_fences(text: str) -> bool:
    active_marker: str | None = None
    active_length = 0

    for line in text.splitlines():
        match = FENCE_RE.match(line)
        if not match:
            continue
        fence = match.group(1)
        marker = fence[0]
        if active_marker is None:
            active_marker = marker
            active_length = len(fence)
        elif marker == active_marker and len(fence) >= active_length:
            active_marker = None
            active_length = 0

    return active_marker is None


def clean_markdown_target(raw_target: str) -> str:
    target = raw_target.strip()
    if target.startswith("<") and ">" in target:
        return target[1 : target.index(">")]
    return target.split(maxsplit=1)[0]


def resolve_local_target(source: Path, raw_target: str) -> Path | None:
    target = clean_markdown_target(raw_target)
    if not target or target.startswith(("#", "/", "\\")):
        return None
    if WINDOWS_ABSOLUTE_RE.match(target):
        return None

    parsed = urlsplit(target)
    if parsed.scheme or parsed.netloc:
        return None

    path_text = unquote(parsed.path)
    if not path_text:
        return None
    return (source.parent / path_text).resolve()


def validate() -> list[str]:
    errors: list[str] = []
    referenced_assets: set[Path] = set()

    unexpected_root_files = sorted(
        path.name
        for path in DOCS.iterdir()
        if path.is_file()
        and path.name not in ALLOWED_DOCS_ROOT_FILES
        and path.name not in IGNORED_DOCS_ROOT_FILES
    )
    if unexpected_root_files:
        errors.append(
            "docs/ root contains uncategorized files: "
            + ", ".join(unexpected_root_files)
        )

    for source in iter_document_files():
        relative_source = source.relative_to(ROOT)
        try:
            text = source.read_text(encoding="utf-8")
        except UnicodeDecodeError as exc:
            errors.append(f"{relative_source}: invalid UTF-8 ({exc})")
            continue

        if source.suffix.lower() == ".md" and not has_balanced_fences(text):
            errors.append(f"{relative_source}: unbalanced fenced code block")

        searchable_text = strip_fenced_blocks(text) if source.suffix.lower() == ".md" else text
        references: list[tuple[str, bool]] = []
        references.extend(
            (match.group(2), bool(match.group(1)))
            for match in MARKDOWN_LINK_RE.finditer(searchable_text)
        )
        references.extend(
            (match.group(3), match.group(1).lower() == "img")
            for match in HTML_LINK_RE.finditer(searchable_text)
        )

        for raw_target, is_asset in references:
            resolved = resolve_local_target(source, raw_target)
            if resolved is None:
                continue
            if not resolved.exists():
                errors.append(f"{relative_source}: missing local target {raw_target}")
                continue
            if is_asset or (DOCS / "screenshots").resolve() in resolved.parents:
                referenced_assets.add(resolved)

    screenshots = DOCS / "screenshots"
    if screenshots.exists():
        for asset in sorted(path.resolve() for path in screenshots.rglob("*") if path.is_file()):
            if asset not in referenced_assets:
                errors.append(
                    f"{asset.relative_to(ROOT)}: screenshot asset is not referenced"
                )

    return errors


def main() -> int:
    errors = validate()
    if errors:
        print("Documentation validation failed:")
        for error in errors:
            print(f"- {error}")
        return 1

    print("Documentation structure, links, code fences, and assets are valid.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
