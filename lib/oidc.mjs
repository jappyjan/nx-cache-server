import { createHash, randomBytes } from 'node:crypto';

const base64Url = (value) => Buffer.from(value).toString('base64url');

export function createOidcClient({ issuer, clientId, clientSecret, redirectUri }) {
  const pending = new Map();
  let discovery;
  async function config() {
    discovery ??= fetch(new URL('.well-known/openid-configuration', issuer.endsWith('/') ? issuer : `${issuer}/`)).then(async (response) => {
      if (!response.ok) throw new Error('OIDC discovery failed');
      return response.json();
    });
    return discovery;
  }
  return {
    async authorizationUrl() {
      const state = randomBytes(24).toString('base64url');
      const verifier = randomBytes(32).toString('base64url');
      pending.set(state, { verifier, expiresAt: Date.now() + 10 * 60 * 1000 });
      const oidc = await config();
      const url = new URL(oidc.authorization_endpoint);
      url.search = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope: 'openid profile email', state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
      return url;
    },
    async exchangeCallback({ code, state }) {
      const transaction = pending.get(state);
      pending.delete(state);
      if (!code || !transaction || transaction.expiresAt < Date.now()) throw new Error('Invalid OIDC login state');
      const oidc = await config();
      const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, code_verifier: transaction.verifier });
      if (clientSecret) body.set('client_secret', clientSecret);
      const token = await fetch(oidc.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
      if (!token.ok) throw new Error('OIDC code exchange failed');
      const { access_token: accessToken } = await token.json();
      const user = await fetch(oidc.userinfo_endpoint, { headers: { authorization: `Bearer ${accessToken}` } });
      if (!user.ok) throw new Error('OIDC userinfo request failed');
      const profile = await user.json();
      if (!profile.email_verified || typeof profile.email !== 'string') throw new Error('OIDC provider did not verify an email');
      return profile.email.toLowerCase();
    }
  };
}
