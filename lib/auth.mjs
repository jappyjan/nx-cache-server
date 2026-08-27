import { createHmac, timingSafeEqual } from 'node:crypto';
import { hashToken } from './state.mjs';

const equal = (left, right) => {
  if (!left || !right || left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
};

export function createCacheAuthorizer({ state }) {
  return async (token) => {
    const digest = hashToken(token);
    const managed = (await state.load()).tokens.find((item) => !item.revokedAt && equal(item.hash, digest));
    if (!managed) return null;
    await state.update((data) => {
      const item = data.tokens.find((candidate) => candidate.id === managed.id);
      if (item) item.lastUsedAt = new Date().toISOString();
    });
    return { writable: managed.permission !== 'ro', kind: managed.permission === 'ro' ? 'read-only' : 'read-write', tokenId: managed.id };
  };
}

export function createSessionManager(secret) {
  if (!secret) return null;
  const sign = (payload) => createHmac('sha256', secret).update(payload).digest('base64url');
  return {
    create(email) {
      const payload = Buffer.from(JSON.stringify({ email, exp: Date.now() + 8 * 60 * 60 * 1000 })).toString('base64url');
      return `${payload}.${sign(payload)}`;
    },
    verify(value) {
      const [payload, signature] = value?.split('.') ?? [];
      if (!payload || !signature || !equal(signature, sign(payload))) return null;
      try {
        const session = JSON.parse(Buffer.from(payload, 'base64url').toString());
        return session.exp > Date.now() && typeof session.email === 'string' ? session : null;
      } catch { return null; }
    }
  };
}
