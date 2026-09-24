---
name: redis
description: Baseline conventions for Redis as cache, lock or queue backend: keys, expiry, atomic operations and failure behavior.
status: baseline
---

## Princípio

Treat Redis as fast, volatile shared state: every key has an owner and an expiry, multi-step changes use atomic operations, and the application keeps working, degraded, when Redis is down.

## Quando aplicar

Projects using Redis as a cache, lock, rate limiter or queue backend.

## Quando não aplicar

Durable data: Redis is not the system of record unless the project says so and configures persistence for it.

## Exemplo

```python
def get_profile(user_id: int) -> dict:
    key = f"profile:v1:{user_id}"
    cached = redis.get(key)
    if cached:
        return json.loads(cached)
    profile = load_profile(user_id)
    redis.set(key, json.dumps(profile), ex=300)
    return profile

# atomic, expiring lock instead of check-then-set
acquired = redis.set(f"lock:invoice:{invoice_id}", token, nx=True, ex=30)
```

Namespace and version keys, set an expiry on every cache key, invalidate on the write path that changes the data, use `SET NX EX` (or a proven library) for locks and release only with your own token, and never store secrets or unbounded lists.

## Fonte

Redis documentation (data types, expiry, SET options); refined per project conventions.
