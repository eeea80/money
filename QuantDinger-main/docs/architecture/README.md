# Architecture Overview

QuantDinger v5 separates HTTP request handling, long-running trading,
scheduling, finite background jobs, and database migration into explicit
process roles. PostgreSQL coordinates durable ownership; the two Redis tiers
serve different reliability requirements.

## Runtime ownership

| Surface | Owns | Must not own |
| --- | --- | --- |
| `backend` | Authentication, validation, queries, durable command submission | Trading loops and long-running schedules |
| `trading-worker` | Strategy runtimes, broker sessions, orders, leases, reconciliation | Public HTTP request handling |
| `scheduler-worker` | Portfolio, deployment, payment, and notification schedules | General Celery work |
| `celery-worker` | Finite, serializable, retryable jobs | Persistent trading runtimes |
| `migration` | Ordered schema updates | Concurrent API serving |

## State and coordination

- PostgreSQL is the source of truth for commands, leases, heartbeats, audit
  records, strategies, and trading state.
- `redis` is an evictable cache and must not hold durable queue state.
- `redis-jobs` is the Celery broker/result tier, uses AOF and `noeviction`, and
  must be monitored for memory pressure.
- Idempotency keys, database claims, renewable leases, and fencing tokens
  protect duplicate or stale execution.

## Read by task

| Task | Document |
| --- | --- |
| Understand package and process ownership | [Backend architecture](ARCHITECTURE.md) |
| Preserve dependency direction | [Module boundaries](MODULE_BOUNDARIES.md) |
| Change concurrent or durable work | [Concurrency model](CONCURRENCY_MODEL.md) |
| Decide which process owns work | [Process roles](PROCESS_ROLES_AND_TASKS.md) |
| Add routes, adapters, tasks, or services | [Extension guide](EXTENSION_GUIDE.md) |
| Change an HTTP contract | [API conventions](API_CONVENTIONS.md) |

Before a large change, identify the owner process, source of truth, retry and
idempotency behavior, and the test that proves the boundary remains intact.
