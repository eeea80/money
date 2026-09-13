# Installation Troubleshooting

Use this guide for first-time Docker and Compose failures. Run commands from
the repository root, next to `docker-compose.yml`.

[中文](INSTALL_TROUBLESHOOTING_CN.md)

## First checks

```bash
docker compose pull
docker compose up -d
docker compose ps
docker compose logs --tail=100 postgres migration backend
```

Read the first failing dependency, not only the final `backend` error. The
normal startup order is PostgreSQL and Redis, then `migration`, then the API and
workers.

## Image pull fails

Typical errors mention `registry-1.docker.io`, `failed to resolve reference`,
timeouts, or a missing Docker Desktop HTTPS proxy.

1. Confirm that the proxy port is listening on the host.
2. In Docker Desktop, open **Settings → Resources → Proxies**.
3. Configure both HTTP and HTTPS with the working HTTP proxy URL.
4. Apply the change and fully restart Docker Desktop.
5. Verify with `docker info`, then retry `docker compose pull`.

On Windows, a focused connectivity check is:

```powershell
curl.exe -x http://127.0.0.1:10808 https://registry-1.docker.io/v2/
docker info | findstr /i proxy
```

An `UNAUTHORIZED` response from `/v2/` means the registry is reachable; the
endpoint expects Docker's authentication flow. A timeout or connection failure
means the network path is still blocked.

## PostgreSQL is unhealthy after an upgrade

If logs say the data directory was initialized by a different PostgreSQL major
version, do not repeatedly restart the container. PostgreSQL data directories
cannot be reused across major versions without migration.

For disposable local data only:

```bash
docker compose down -v
docker compose up -d
```

> `down -v` permanently deletes Compose volumes, including the local database.
> Never use it when the data must be retained.

For retained data, start the original PostgreSQL major version and migrate with
`pg_dump`/`pg_restore` or `pg_upgrade`. Back up the data before changing the
image or volume.

## Migration does not complete

```bash
docker compose ps migration
docker compose logs --tail=200 migration
docker compose logs --tail=100 postgres
```

Do not start schema changes concurrently from API workers. The bundled
`migration` service owns schema upgrades; dependent services wait for it to
finish successfully.

## Backend exits or health check fails

```bash
docker compose logs --tail=200 backend
docker compose exec backend curl -f http://localhost:5000/api/health
```

Check these first:

- `.env` and `backend_api_python/.env` exist in source deployments;
- the GHCR deployment references the generated `backend.env`;
- `POSTGRES_PASSWORD`, `SECRET_KEY`, and `CREDENTIAL_ENCRYPTION_KEY` are not
  missing or placeholder values;
- all services use the same PostgreSQL and Redis credentials;
- the `migration` service has completed.

For administrator or settings-save issues, use
[Administrator Credentials and Settings Save Troubleshooting](ADMIN_AND_SETTINGS_TROUBLESHOOTING_EN.md).

## Safe recovery commands

```bash
# Inspect status and recent logs
docker compose ps
docker compose logs --tail=100 backend trading-worker scheduler-worker

# Recreate containers while retaining volumes
docker compose up -d --force-recreate

# Stop containers while retaining volumes
docker compose down
```

Use destructive volume removal only after confirming that a verified backup
exists or the local data is intentionally disposable.
