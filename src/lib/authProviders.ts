export type GoogleSignInPayload = {
  idToken: string | null;
};

type GoogleResponseLike =
  | { type: 'success'; data: { idToken?: string | null } }
  | { idToken?: string | null }
  | null
  | undefined;

export function googleSignInPayload(response: GoogleResponseLike): GoogleSignInPayload | null {
  if (!response) return null;
  if ('type' in response) {
    return response.type === 'success'
      ? { idToken: response.data.idToken ?? null }
      : null;
  }
  return { idToken: response.idToken ?? null };
}

export function randomNonceFromBytes(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function appleCredentialParams(identityToken: string | null, rawNonce: string) {
  if (!identityToken) throw new Error('Apple did not return an identity token.');
  if (!rawNonce) throw new Error('Apple nonce is missing.');
  return { idToken: identityToken, rawNonce };
}

function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  return decodeURIComponent(
    Array.from(atob(padded), (character) =>
      `%${character.charCodeAt(0).toString(16).padStart(2, '0')}`
    ).join('')
  );
}

export type AppleTokenDiagnostics = {
  audience: string | string[] | null;
  issuer: string | null;
  noncePresent: boolean;
  nonceMatchesRequest: boolean | null;
};

export function inspectAppleTokenClaims(
  identityToken: string,
  expectedHashedNonce: string
): AppleTokenDiagnostics {
  try {
    const payload = JSON.parse(decodeBase64Url(identityToken.split('.')[1] ?? '')) as {
      aud?: unknown;
      iss?: unknown;
      nonce?: unknown;
    };
    const nonce = typeof payload.nonce === 'string' ? payload.nonce : null;
    return {
      audience:
        typeof payload.aud === 'string' ||
        (Array.isArray(payload.aud) && payload.aud.every((item) => typeof item === 'string'))
          ? (payload.aud as string | string[])
          : null,
      issuer: typeof payload.iss === 'string' ? payload.iss : null,
      noncePresent: nonce !== null,
      nonceMatchesRequest: nonce === null ? null : nonce === expectedHashedNonce,
    };
  } catch {
    return {
      audience: null,
      issuer: null,
      noncePresent: false,
      nonceMatchesRequest: null,
    };
  }
}

export function oauthProjectNumber(clientId: string | null): string | null {
  return clientId?.match(/^(\d+)-/)?.[1] ?? null;
}

export function oauthClientsShareProject(
  webClientId: string | null,
  iosClientId: string | null
): boolean {
  const webProject = oauthProjectNumber(webClientId);
  const iosProject = oauthProjectNumber(iosClientId);
  return webProject !== null && webProject === iosProject;
}

export function isAccountCollision(error: unknown): boolean {
  return (error as { code?: string })?.code === 'auth/account-exists-with-different-credential';
}

export type SocialProvider = 'google' | 'apple';

export function socialAuthErrorMessage(error: unknown, provider: SocialProvider): string {
  const label = provider === 'google' ? 'Google' : 'Apple';
  switch ((error as { code?: string })?.code) {
    case 'auth/account-exists-with-different-credential':
      return provider === 'google'
        ? 'An account already exists for this email. Sign in with your password first; CardioSurf will then securely link Google to that account.'
        : 'An account already exists for this email. Sign in with that method first, then retry Apple Sign-In to link a fresh Apple credential.';
    case 'auth/credential-already-in-use':
      return `This ${label} account is already connected to another CardioSurf account.`;
    case 'auth/invalid-credential':
      return `${label} Sign-In could not be verified. Please try again.`;
    case 'auth/network-request-failed':
      return 'Check your connection and try again.';
    case 'auth/operation-not-allowed':
      return `${label} Sign-In is not enabled for this app.`;
    default:
      return `${label} Sign-In failed. Please try again.`;
  }
}
