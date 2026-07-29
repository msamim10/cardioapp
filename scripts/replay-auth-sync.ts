import assert from 'node:assert/strict';
// @ts-expect-error -- Node type-stripping requires the source extension.
import { decideAuthGate } from '../src/lib/authGate.ts';
// @ts-expect-error -- Node type-stripping requires the source extension.
import { mergeRuns, newerState, normalizeRunRecord } from '../src/lib/progressSync.ts';
// @ts-expect-error -- Node type-stripping requires the source extension.
import { createRevenueCatIdentityState, synchronizeRevenueCatIdentity } from '../src/lib/revenueCatIdentity.ts';

const legacy = normalizeRunRecord(
  { levelId: 'level-1', at: 100, durationMin: 5, calories: 20 },
  0
);
assert.ok(legacy);
assert.equal(legacy.runId, 'legacy:100:0:level-1');
assert.equal(legacy.classKey, undefined);
assert.equal(legacy.poseScore, 0);
assert.deepEqual(legacy.actionCounts, { Jump: 0, Duck: 0, Left: 0, Right: 0 });

const run = {
  ...legacy,
  runId: 'stable-run',
  at: 200,
};
const cloudCopy = { ...run };
assert.deepEqual(mergeRuns([run], [cloudCopy]), [run], 'duplicate IDs must collapse');

const cloudOlder = { ...run, calories: 10, at: 150 };
const localNewer = { ...run, calories: 30, at: 250 };
assert.deepEqual(mergeRuns([localNewer], [cloudOlder]), [localNewer]);

const another = { ...run, runId: 'another', at: 300 };
assert.deepEqual(
  mergeRuns([localNewer], [another]).map((item) => item.runId),
  ['stable-run', 'another']
);

assert.deepEqual(
  newerState({ stateUpdatedAt: 20, value: 'local' }, { stateUpdatedAt: 10, value: 'cloud' }),
  { stateUpdatedAt: 20, value: 'local' }
);
assert.deepEqual(
  newerState({ stateUpdatedAt: 20, value: 'local' }, { stateUpdatedAt: 30, value: 'cloud' }),
  { stateUpdatedAt: 30, value: 'cloud' }
);

assert.equal(
  decideAuthGate({ hydrated: false, onboardingCompleted: false, authenticated: false }),
  'loading'
);
assert.equal(
  decideAuthGate({ hydrated: true, onboardingCompleted: false, authenticated: false }),
  'welcome'
);
assert.equal(
  decideAuthGate({ hydrated: true, onboardingCompleted: true, authenticated: false }),
  'create-account'
);
assert.equal(
  decideAuthGate({ hydrated: true, onboardingCompleted: false, authenticated: true }),
  'welcome'
);
assert.equal(
  decideAuthGate({ hydrated: true, onboardingCompleted: true, authenticated: true }),
  'tabs'
);

type FakeCustomerInfo = { appUserID: string };

function createFakePurchases(initialUserID: string, initiallyAnonymous: boolean) {
  let appUserID = initialUserID;
  let anonymous = initiallyAnonymous;
  const calls: string[] = [];
  const info = (): FakeCustomerInfo => ({ appUserID });
  return {
    calls,
    adapter: {
      async getAppUserID() {
        calls.push('getAppUserID');
        return appUserID;
      },
      async getCustomerInfo() {
        calls.push('getCustomerInfo');
        return info();
      },
      async isAnonymous() {
        calls.push('isAnonymous');
        return anonymous;
      },
      async logIn(uid: string) {
        calls.push(`logIn:${uid}`);
        appUserID = uid;
        anonymous = false;
        return info();
      },
      async logOut() {
        calls.push('logOut');
        appUserID = '$RCAnonymousID:new';
        anonymous = true;
        return info();
      },
    },
  };
}

{
  const fake = createFakePurchases('$RCAnonymousID:startup', true);
  const state = createRevenueCatIdentityState<FakeCustomerInfo>();
  const info = await synchronizeRevenueCatIdentity(fake.adapter, null, state);
  assert.equal(info?.appUserID, '$RCAnonymousID:startup');
  assert.deepEqual(fake.calls, ['isAnonymous', 'getCustomerInfo']);

  await synchronizeRevenueCatIdentity(fake.adapter, null, state);
  assert.deepEqual(
    fake.calls,
    ['isAnonymous', 'getCustomerInfo'],
    'duplicate null and provider remount events must be coalesced',
  );
}

{
  const fake = createFakePurchases('firebase-1', false);
  const state = createRevenueCatIdentityState<FakeCustomerInfo>();
  await synchronizeRevenueCatIdentity(fake.adapter, 'firebase-1', state);
  assert.deepEqual(fake.calls, ['getAppUserID', 'getCustomerInfo']);
}

{
  const fake = createFakePurchases('$RCAnonymousID:before-login', true);
  const state = createRevenueCatIdentityState<FakeCustomerInfo>();
  const info = await synchronizeRevenueCatIdentity(fake.adapter, 'firebase-2', state);
  assert.equal(info?.appUserID, 'firebase-2');
  assert.deepEqual(fake.calls, ['getAppUserID', 'logIn:firebase-2']);
}

{
  const fake = createFakePurchases('firebase-3', false);
  const state = createRevenueCatIdentityState<FakeCustomerInfo>();
  const info = await synchronizeRevenueCatIdentity(fake.adapter, null, state);
  assert.equal(info?.appUserID, '$RCAnonymousID:new');
  assert.deepEqual(fake.calls, ['isAnonymous', 'logOut']);
}

{
  const fake = createFakePurchases('$RCAnonymousID:concurrent', true);
  const state = createRevenueCatIdentityState<FakeCustomerInfo>();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const originalGetAppUserID = fake.adapter.getAppUserID;
  fake.adapter.getAppUserID = async () => {
    await gate;
    return originalGetAppUserID();
  };

  const first = synchronizeRevenueCatIdentity(fake.adapter, 'firebase-4', state);
  const duplicate = synchronizeRevenueCatIdentity(fake.adapter, 'firebase-4', state);
  const latest = synchronizeRevenueCatIdentity(fake.adapter, 'firebase-5', state);
  assert.equal(first, duplicate);
  assert.equal(first, latest);
  release();
  const info = await latest;
  assert.equal(info?.appUserID, 'firebase-5');
  assert.deepEqual(fake.calls, [
    'getAppUserID',
    'logIn:firebase-4',
    'getAppUserID',
    'logIn:firebase-5',
  ]);
}

console.log('Auth gate, progress sync, and RevenueCat identity replay checks passed.');
