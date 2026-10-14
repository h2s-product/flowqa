/**
 * Token OAuth Google dari Service Account (alur JWT bearer, RFC 7523), tanpa
 * library tambahan: JWT ditandatangani RS256 dengan node:crypto lalu ditukar
 * ke token akses di token_uri. Token di-cache sampai hampir kedaluwarsa.
 */
import crypto from 'node:crypto';

export const APP_DISTRIBUTION_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';

export interface ServiceAccountKey {
  type: string;
  client_email: string;
  private_key: string;
  project_id?: string;
  token_uri?: string;
}

export class FirebaseError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

/** Parse & validasi file JSON key Service Account. */
export function parseServiceAccount(json: string): ServiceAccountKey {
  let key: ServiceAccountKey;
  try {
    key = JSON.parse(json);
  } catch {
    throw new FirebaseError('The service account key is not valid JSON.');
  }
  if (key?.type !== 'service_account' || !key.client_email || !key.private_key?.includes('PRIVATE KEY'))
    throw new FirebaseError(
      'This is not a service account key file (expected "type": "service_account" with a private key).',
    );
  try {
    crypto.createPrivateKey(key.private_key);
  } catch {
    throw new FirebaseError('The private key in the service account file cannot be read.');
  }
  return key;
}

const b64url = (data: Buffer | string) => Buffer.from(data).toString('base64url');

/** JWT RS256 untuk token_uri Google. */
export function signJwt(key: ServiceAccountKey, scope: string, now = Math.floor(Date.now() / 1000)): string {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(
    JSON.stringify({
      iss: key.client_email,
      scope,
      aud: key.token_uri || DEFAULT_TOKEN_URI,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signature = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), key.private_key);
  return `${header}.${claims}.${b64url(signature)}`;
}

export class GoogleTokenSource {
  private cached: { token: string; expiresAt: number; email: string } | null = null;

  async token(key: ServiceAccountKey, scope = APP_DISTRIBUTION_SCOPE): Promise<string> {
    if (this.cached && this.cached.email === key.client_email && this.cached.expiresAt > Date.now() + 60_000)
      return this.cached.token;
    const response = await fetch(key.token_uri || DEFAULT_TOKEN_URI, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: signJwt(key, scope),
      }),
      signal: AbortSignal.timeout(20_000),
    }).catch((error) => {
      throw new FirebaseError(`Could not reach Google to sign in: ${(error as Error).message}`);
    });
    const data = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (!response.ok || !data.access_token)
      throw new FirebaseError(
        `Google rejected the service account: ${data.error_description || data.error || `HTTP ${response.status}`}. Check that the key is active.`,
        response.status,
      );
    this.cached = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
      email: key.client_email,
    };
    return data.access_token;
  }

  reset() {
    this.cached = null;
  }
}
