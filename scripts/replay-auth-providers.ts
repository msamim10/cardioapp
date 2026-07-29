import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// @ts-expect-error -- Node type-stripping requires the source extension.
import { appleCredentialParams, googleSignInPayload, inspectAppleTokenClaims, isAccountCollision, oauthClientsShareProject, randomNonceFromBytes, socialAuthErrorMessage } from '../src/lib/authProviders.ts';

assert.equal(randomNonceFromBytes(new Uint8Array([0, 1, 15, 16, 255])), '00010f10ff');
assert.deepEqual(appleCredentialParams('identity-token', 'raw-nonce'), {
  idToken: 'identity-token',
  rawNonce: 'raw-nonce',
});
assert.throws(() => appleCredentialParams(null, 'raw-nonce'), /identity token/);
assert.throws(() => appleCredentialParams('identity-token', ''), /nonce/);

assert.deepEqual(googleSignInPayload({ type: 'success', data: { idToken: 'modern' } }), {
  idToken: 'modern',
});
assert.deepEqual(googleSignInPayload({ idToken: 'legacy' }), { idToken: 'legacy' });
assert.equal(googleSignInPayload(null), null);

const encode = (value: object) =>
  btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
const token = `${encode({ alg: 'none' })}.${encode({
  aud: 'com.cardiosurf.app',
  iss: 'https://appleid.apple.com',
  nonce: 'hashed-nonce',
})}.signature`;
assert.deepEqual(inspectAppleTokenClaims(token, 'hashed-nonce'), {
  audience: 'com.cardiosurf.app',
  issuer: 'https://appleid.apple.com',
  noncePresent: true,
  nonceMatchesRequest: true,
});

const collision = { code: 'auth/account-exists-with-different-credential' };
assert.equal(isAccountCollision(collision), true);
assert.match(socialAuthErrorMessage(collision, 'google'), /password first/);
assert.match(socialAuthErrorMessage(collision, 'apple'), /retry Apple Sign-In/);
assert.match(
  socialAuthErrorMessage({ code: 'auth/invalid-credential' }, 'apple'),
  /could not be verified/
);

const app = JSON.parse(readFileSync(`${process.cwd()}/app.json`, 'utf8'));
const eas = JSON.parse(readFileSync(`${process.cwd()}/eas.json`, 'utf8'));
const env = readFileSync(`${process.cwd()}/.env`, 'utf8');
const webClientId = eas.build.base.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID as string;
const iosClientId = eas.build.base.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID as string;
const reversedClientId = iosClientId.replace(
  /\.apps\.googleusercontent\.com$/,
  ''
);
assert.equal(oauthClientsShareProject(webClientId, iosClientId), true);
assert.equal(
  app.expo.plugins.find(
    (plugin: unknown) => Array.isArray(plugin) && plugin[0] === '@react-native-google-signin/google-signin'
  )[1].iosUrlScheme,
  `com.googleusercontent.apps.${reversedClientId}`
);
assert.match(env, new RegExp(`EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=${iosClientId.replaceAll('.', '\\.')}`));

console.log('Auth provider replay checks passed.');
