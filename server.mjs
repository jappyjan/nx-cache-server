import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createStateStore, hashToken, newToken } from './lib/state.mjs';
import { createCacheAuthorizer, createSessionManager } from './lib/auth.mjs';
import { createOidcClient } from './lib/oidc.mjs';
import { createCache } from './lib/cache.mjs';
import { migrateEnvironmentTokens } from './lib/migrate.mjs';

const dir = process.env.CACHE_DIR ?? '/data';
const port = Number(process.env.PORT ?? 3000);
const rw = process.env.TOKEN_RW;
const ro = process.env.TOKEN_RO || rw;
await mkdir(dir, { recursive: true });
const state = await createStateStore(dir);
await migrateEnvironmentTokens(state, rw, ro);
const cache = createCache(dir, state);
const authorize = createCacheAuthorizer({ state });
const session = createSessionManager(process.env.SESSION_SECRET);
const oidc = process.env.OIDC_ISSUER && process.env.OIDC_CLIENT_ID && process.env.OIDC_REDIRECT_URI ? createOidcClient({ issuer: process.env.OIDC_ISSUER, clientId: process.env.OIDC_CLIENT_ID, clientSecret: process.env.OIDC_CLIENT_SECRET, redirectUri: process.env.OIDC_REDIRECT_URI }) : null;
const fail = (res, status, message, json = false) => res.writeHead(status, { 'content-type': json ? 'application/json' : 'text/plain' }).end(json ? JSON.stringify({ error: message }) : message);
const body = async (req) => JSON.parse(await new Promise((resolve, reject) => { let data = ''; req.on('data', (part) => data += part).on('end', () => resolve(data)).on('error', reject); }));
const cookie = (req, name) => (req.headers.cookie ?? '').split('; ').find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
const audit = (action, detail) => state.update((data) => { data.audit.unshift({ at: new Date().toISOString(), action, detail }); data.audit.splice(1000); });

async function admin(req, res, url) {
  if (!session || !oidc) return fail(res, 404, 'admin UI is not configured');
  if (url.pathname === '/admin/login') return res.writeHead(302, { location: await oidc.authorizationUrl() }).end();
  if (url.pathname === '/admin/callback') {
    try {
      const email = await oidc.exchangeCallback(Object.fromEntries(url.searchParams));
      const allowed = await state.update((data) => { if (!data.admins.length) data.admins.push(email); return data.admins.includes(email); });
      if (!allowed) return fail(res, 403, 'email is not allowed');
      await audit('login', email);
      return res.writeHead(302, { location: '/admin', 'set-cookie': `nx_cache_session=${session.create(email)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=28800` }).end();
    } catch (error) { return fail(res, 400, error.message); }
  }
  const user = session.verify(cookie(req, 'nx_cache_session'));
  if (!user || !(await state.load()).admins.includes(user.email)) return url.pathname === '/admin' ? res.writeHead(302, { location: '/admin/login' }).end() : fail(res, 401, 'unauthorized', true);
  if (url.pathname === '/admin') return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(await readFile('./public/admin.html'));
  if (url.pathname === '/admin/app.js' || url.pathname === '/admin/app.css') return res.writeHead(200, { 'content-type': url.pathname.endsWith('.js') ? 'text/javascript' : 'text/css', 'cache-control': 'no-store' }).end(await readFile(`./public/${url.pathname.endsWith('.js') ? 'admin.js' : 'admin.css'}`));
  const installer = /^\/admin\/install\/(macos\.sh|linux\.sh|windows\.ps1)$/.exec(url.pathname)?.[1];
  if (installer) return res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'content-disposition': `attachment; filename=${installer}` }).end(await readFile(`./public/install/${installer}`));
  if (url.pathname === '/admin/api/summary') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ...(await cache.summary()), audit: (await state.load()).audit.slice(0, 20) }));
  if (url.pathname === '/admin/api/tokens' && req.method === 'GET') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify((await state.load()).tokens.map(({ hash, ...token }) => token)));
  if (url.pathname === '/admin/api/tokens' && req.method === 'POST') { const { label, permission = 'rw' } = await body(req); if (!label?.trim() || !['rw', 'ro'].includes(permission)) return fail(res, 400, 'label and permission are required', true); const token = newToken(); const item = { id: randomUUID(), label: label.trim(), prefix: token.slice(0, 8), hash: hashToken(token), permission, createdBy: user.email, createdAt: new Date().toISOString() }; await state.update((data) => data.tokens.push(item)); await audit('token-created', item.label); return res.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify({ ...item, token })); }
  const tokenId = /^\/admin\/api\/tokens\/([^/]+)(?:\/(rotate))?$/.exec(url.pathname);
  if (tokenId && req.method === 'DELETE') { await state.update((data) => { const item = data.tokens.find((token) => token.id === tokenId[1]); if (item) item.revokedAt = new Date().toISOString(); }); await audit('token-revoked', tokenId[1]); return res.writeHead(204).end(); }
  if (tokenId?.[2] === 'rotate' && req.method === 'POST') { const token = newToken(); let item; await state.update((data) => { const old = data.tokens.find((candidate) => candidate.id === tokenId[1]); if (!old) return; old.revokedAt = new Date().toISOString(); item = { ...old, id: randomUUID(), prefix: token.slice(0, 8), hash: hashToken(token), createdAt: new Date().toISOString(), lastUsedAt: undefined, revokedAt: undefined }; data.tokens.push(item); }); if (!item) return fail(res, 404, 'token not found', true); await audit('token-rotated', item.label); return res.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify({ ...item, token })); }
  if (url.pathname === '/admin/api/admins' && req.method === 'GET') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify((await state.load()).admins));
  if (url.pathname === '/admin/api/admins' && req.method === 'POST') { const { email } = await body(req); if (!/^\S+@\S+\.\S+$/.test(email ?? '')) return fail(res, 400, 'valid email is required', true); await state.update((data) => { if (!data.admins.includes(email.toLowerCase())) data.admins.push(email.toLowerCase()); }); await audit('admin-added', email); return res.writeHead(201).end(); }
  if (url.pathname.startsWith('/admin/api/admins/') && req.method === 'DELETE') { const email = decodeURIComponent(url.pathname.slice('/admin/api/admins/'.length)); const result = await state.update((data) => { if (data.admins.length <= 1) return false; data.admins = data.admins.filter((item) => item !== email); return true; }); return result ? res.writeHead(204).end() : fail(res, 409, 'at least one admin is required', true); }
  if (url.pathname === '/admin/api/entries' && req.method === 'GET') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(await cache.list(url.searchParams.get('page') ?? 1)));
  if (url.pathname === '/admin/api/entries' && req.method === 'DELETE') { const deleted = await cache.clear(); await audit('cache-cleared', `${deleted} entries`); return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ deleted })); }
  if (url.pathname.startsWith('/admin/api/entries/') && req.method === 'DELETE') { await cache.delete(url.pathname.slice('/admin/api/entries/'.length)).catch(() => {}); await audit('entry-deleted', url.pathname); return res.writeHead(204).end(); }
  return fail(res, 404, 'not found', true);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/health') return res.writeHead(200).end('ok');
  if (url.pathname === '/') return res.writeHead(302, { location: '/admin' }).end();
  if (url.pathname.startsWith('/admin')) return admin(req, res, url).catch((error) => fail(res, 500, error.message, true));
  const hash = /^\/v1\/cache\/([\w-]+)$/.exec(url.pathname)?.[1];
  if (!hash) return fail(res, 404, 'not found');
  const access = await authorize((req.headers.authorization ?? '').slice(7));
  if (!access) return fail(res, 401, 'unauthorized');
  if (req.method === 'GET') return cache.read(hash).on('error', () => fail(res, 404, 'cache miss')).on('open', () => { cache.touch(hash); res.writeHead(200, { 'content-type': 'application/octet-stream' }); }).pipe(res);
  if (req.method === 'PUT') { if (!access.writable) return fail(res, 403, 'read-only token'); try { await cache.write(hash, req); await audit('cache-write', hash); return res.writeHead(202).end(); } catch (error) { return fail(res, error.message === 'exists' ? 409 : 500, error.message === 'exists' ? 'already cached' : 'write failed'); } }
  return fail(res, 405, 'method not allowed');
});
setInterval(() => cache.prune(Date.now() - Number(process.env.PRUNE_AFTER_DAYS ?? 14) * 86_400_000), 6 * 3_600_000);
server.listen(port, () => console.log(`nx cache on :${port}, store ${dir}`));
