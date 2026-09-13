# Local Production Branch Policy

This server keeps public code and private production behavior separate.

## Branch roles

- `main`: public upstream branch. Keep it clean and synchronized with `origin/main`.
- `local/production-private`: local-only stable deployment branch. The API service should run from this branch.
- `local/admin-ops`: local-only operations and experiment notes/scripts. Do not run production from this branch.
- `local/<feature>`: local-only private feature development. Merge only validated changes into `local/production-private`.

## Deployment rule

Production should run only from a stable branch:

```bash
git switch local/production-private
git merge --ff-only main
systemctl restart ai-trader-api
```

If a private feature is ready for production, merge it into `local/production-private` first, then restart the service.

Do not push `local/*` branches to the public remote.
