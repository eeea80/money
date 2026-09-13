#!/usr/bin/env python3
"""Reject known unsafe defaults before a production deployment."""

from __future__ import annotations

import argparse
import os
from pathlib import Path


UNSAFE_VALUES = {
    "SECRET_KEY": {"", "quantdinger-secret-key-change-me"},
    "CREDENTIAL_ENCRYPTION_KEY": {""},
    "ADMIN_PASSWORD": {"", "123456", "admin", "password"},
    "POSTGRES_PASSWORD": {"", "quantdinger123", "postgres", "password"},
    "GRAFANA_ADMIN_PASSWORD": {"", "change-me-before-production", "admin", "password"},
}


def load_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def validate(values: dict[str, str]) -> list[str]:
    errors = []
    for key, unsafe in UNSAFE_VALUES.items():
        value = values.get(key, "")
        if value.lower() in {item.lower() for item in unsafe}:
            errors.append(f"{key} is missing or uses a known unsafe default")
    if len(values.get("SECRET_KEY", "").encode()) < 10:
        errors.append("SECRET_KEY must contain at least 10 bytes (32+ random bytes recommended)")
    if len(values.get("CREDENTIAL_ENCRYPTION_KEY", "").encode()) < 32:
        errors.append("CREDENTIAL_ENCRYPTION_KEY must contain at least 32 bytes")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env-file", action="append", default=[])
    args = parser.parse_args()

    values: dict[str, str] = {}
    for item in args.env_file:
        values.update(load_env_file(Path(item)))
    values.update({key: value for key, value in os.environ.items() if value})

    errors = validate(values)
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1
    print("Production configuration guard passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
