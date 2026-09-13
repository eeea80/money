"""Fail-fast database migration entrypoint for deployments."""

from __future__ import annotations


def main() -> None:
    print("[migration] database bootstrap starting", flush=True)
    from app.utils.db import init_database

    init_database(strict_migrations=True)
    print("[migration] database bootstrap finished", flush=True)


if __name__ == "__main__":
    main()
