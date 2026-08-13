// Nx self-hosted remote cache server.
// Protocol: https://nx.dev/docs/guides/tasks--caching/self-hosted-caching
//   GET /v1/cache/{hash} -> 200 blob | 404 miss
//   PUT /v1/cache/{hash} -> 202 stored | 403 read-only | 409 already exists
// Auth: Authorization: Bearer <token>
import { createServer } from 'node:http';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat, rename, mkdir, readdir, unlink } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';

const DIR = process.env.CACHE_DIR ?? '/data';
const PORT = Number(process.env.PORT ?? 3000);
const RW = process.env.TOKEN_RW;
const RO = process.env.TOKEN_RO || RW;
const PRUNE_AFTER_DAYS = Number(process.env.PRUNE_AFTER_DAYS ?? 14);

if (!RW) {
  console.error('TOKEN_RW is required');
  process.exit(1);
}

const eq = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

await mkdir(DIR, { recursive: true });

// Nx rejects an endpoint that answers an error without a text/plain body —
// "Misconfigured remote cache endpoint: Requests should respond with text/plain
// on 401s" — so every non-2xx reply carries one.
const fail = (res, code, msg) => res.writeHead(code, { 'content-type': 'text/plain' }).end(msg);

const server = createServer((req, res) => {
  if (req.url === '/health') return res.writeHead(200).end('ok');

  // the regex is also the path-traversal guard: nothing but an Nx hash gets through
  const hash = /^\/v1\/cache\/([\w-]+)$/.exec(req.url)?.[1];
  if (!hash) return fail(res, 404, 'not found');

  const tok = (req.headers.authorization ?? '').slice('Bearer '.length);
  if (!eq(tok, RW) && !eq(tok, RO)) return fail(res, 401, 'unauthorized');

  const file = join(DIR, hash);

  if (req.method === 'GET') {
    return createReadStream(file)
      .on('error', () => fail(res, 404, 'cache miss'))
      .on('open', () => res.writeHead(200, { 'content-type': 'application/octet-stream' }))
      .pipe(res);
  }

  if (req.method === 'PUT') {
    if (!eq(tok, RW)) return fail(res, 403, 'read-only token');
    return stat(file).then(
      () => fail(res, 409, 'already cached'),
      () => {
        // write to a temp file and rename, so a dropped connection never leaves a
        // truncated artifact that Nx would happily restore as a "successful" build
        const tmp = `${file}.${process.pid}.tmp`;
        const out = createWriteStream(tmp);
        out.on('error', () => fail(res, 500, 'write failed'));
        req.on('aborted', () => unlink(tmp).catch(() => {}));
        req.pipe(out).on('finish', () =>
          rename(tmp, file).then(
            () => res.writeHead(202).end(),
            () => fail(res, 500, 'write failed')
          )
        );
      }
    );
  }

  fail(res, 405, 'method not allowed');
});

// ponytail: atime-based eviction, no size cap. relatime gives day-granularity atime,
// which is plenty for a 14-day TTL. Add a byte budget if the volume ever fills.
async function prune() {
  const cutoff = Date.now() - PRUNE_AFTER_DAYS * 86_400_000;
  for (const name of await readdir(DIR).catch(() => [])) {
    const path = join(DIR, name);
    const s = await stat(path).catch(() => null);
    if (s?.isFile() && s.atimeMs < cutoff) await unlink(path).catch(() => {});
  }
}
setInterval(prune, 6 * 3_600_000);
prune();

server.listen(PORT, () => console.log(`nx cache on :${PORT}, store ${DIR}`));
