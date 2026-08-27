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
  -e SESSION_SECRET=$(openssl rand -hex 32) \
  -e OIDC_ISSUER=https://voidauth.example.com/ \
  -e OIDC_CLIENT_ID=nx-cache \
  -e OIDC_CLIENT_SECRET=... \
  -e OIDC_REDIRECT_URI=https://nx-cache.example.com/admin/callback \
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
| `SESSION_SECRET` | — | required to enable the administrator UI |
| `OIDC_ISSUER` | — | VoidAuth issuer URL |
| `OIDC_CLIENT_ID` | — | VoidAuth OIDC client ID |
| `OIDC_CLIENT_SECRET` | — | VoidAuth OIDC client secret, if configured |
| `OIDC_REDIRECT_URI` | — | public `/admin/callback` URL registered with VoidAuth |

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
npm test
```

## Administration

With all OIDC variables configured, open `/admin`. The first VoidAuth user with
a verified email becomes the initial administrator. Administrators can add
other email addresses, issue machine-specific developer tokens, rotate or revoke
them, and inspect or remove cache entries. Token plaintext is returned once at
creation or rotation and is stored only as a SHA-256 hash.

Use the authenticated installer downloads at `/admin/install/` to configure a
developer machine independently of any checkout. macOS uses a user LaunchAgent,
Linux writes `~/.config/environment.d/nx-cache.conf`, and Windows writes
current-user environment variables. Restart terminals and AI agents after
installation. Revoked tokens stop working immediately.

Keep `/data` on a persistent volume: it now contains cache artifacts and
`admin-state.json`, the administrator allowlist, token hashes, activity audit,
and cache metadata. Back it up before redeploying. On the first upgraded start,
the existing `TOKEN_RW` and `TOKEN_RO` values are imported as managed tokens and
are no longer read from the environment after that. Rotate them in the UI, update
the matching GitHub Secrets, then revoke the migrated values. New installations
need no cache-token environment variables; issue all tokens from the UI.
