#!/usr/bin/env python3
"""Verify that every direct production requirement is represented by the lock file."""

from __future__ import annotations

from pathlib import Path

from packaging.requirements import Requirement
from packaging.utils import canonicalize_name


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "requirements.txt"
LOCK = ROOT / "requirements.lock"


def _requirements(path: Path) -> list[Requirement]:
    requirements: list[Requirement] = []
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith(("#", "-r", "--")):
            continue
        requirements.append(Requirement(line))
    return requirements


def main() -> int:
    manifest = _requirements(MANIFEST)
    locked = {
        canonicalize_name(requirement.name): requirement
        for requirement in _requirements(LOCK)
    }

    errors: list[str] = []
    for requirement in manifest:
        name = canonicalize_name(requirement.name)
        locked_requirement = locked.get(name)
        if locked_requirement is None:
            errors.append(f"Missing locked dependency: {requirement.name}")
            continue
        versions = [
            specifier.version
            for specifier in locked_requirement.specifier
            if specifier.operator == "=="
        ]
        if len(versions) != 1:
            errors.append(f"Lock entry must use one exact version: {locked_requirement}")
            continue
        if requirement.specifier and versions[0] not in requirement.specifier:
            errors.append(
                f"Locked version {versions[0]} does not satisfy {requirement}"
            )

    if errors:
        print("Requirements lock validation failed:")
        for error in errors:
            print(f"- {error}")
        return 1

    print(f"Requirements lock validation passed ({len(manifest)} direct dependencies)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
