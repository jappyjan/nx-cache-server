# nx-cache-server

A self-hosted [Nx remote cache](https://nx.dev/docs/guides/tasks--caching/self-hosted-caching) in ~70 lines of Node stdlib. No dependencies, no database, no S3.

Nx 19.8+ speaks a two-endpoint HTTP protocol natively — no plugin needed. The
official `@nx/s3-cache` / `gcs` / `azure` / `shared-fs` packages are
[deprecated](https://nx.dev/docs/reference/deprecated/self-hosted-cache-packages)
because of the unfixable CREEP cache-poisoning flaw (CVE-2025-36852); this server
avoids it with a separate read-only token for untrusted builds.

## Run

```bash
docker build -t nx-cache-server .
docker run -d -p 3000:3000 -v nx-cache:/data \
  -e TOKEN_RW=$(openssl rand -hex 32) \
  -e TOKEN_RO=$(openssl rand -hex 32) \
  nx-cache-server
```

On Coolify: deploy this repo with build pack `dockerfile`, expose port 3000,
add a persistent volume at `/data`, set the two tokens.

| env | default | |
|---|---|---|
| `TOKEN_RW` | — | required; read + write |
| `TOKEN_RO` | `TOKEN_RW` | read only; hand this to PR builds |
| `CACHE_DIR` | `/data` | mount a volume here |
| `PORT` | `3000` | |
| `PRUNE_AFTER_DAYS` | `14` | evicted by last access, checked every 6h |

## Use

```bash
export NX_SELF_HOSTED_REMOTE_CACHE_SERVER=https://nx-cache.example.com
export NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN=<token>
```

In CI, give the read-write token only to builds on your trusted branch and the
read-only token to everything else. A PR that can write to the cache can poison
it: workflow files are not part of the Nx hash, so a malicious PR can produce an
artifact under the same hash main will later restore.

## Test

```bash
./test.sh
```
