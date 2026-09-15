import assert from 'node:assert/strict';
// Node 24 executes this TypeScript replay directly; the app compiler otherwise
// intentionally disallows source imports with a .ts suffix.
import {
  createPaywallRequestRegistry,
  INITIAL_PAYWALL_ROUTE_STATE,
  reducePaywallRoute,
  type PaywallRouteEvent,
  type PaywallRouteState,
  // @ts-expect-error -- required by Node's type-stripping ESM resolver
} from '../src/lib/paywallRoute.ts';

// ---------------------------------------------------------------------------
// reducePaywallRoute: the Paywall component's callbacks → the SDK's result.

const run = (events: PaywallRouteEvent[]): PaywallRouteState =>
  events.reduce(reducePaywallRoute, INITIAL_PAYWALL_ROUTE_STATE);

{
  assert.deepEqual(INITIAL_PAYWALL_ROUTE_STATE, { pending: 'cancelled', settled: null });

  // Close without doing anything → cancelled, settled on the dismiss.
  assert.deepEqual(run([{ type: 'dismiss' }]), { pending: 'cancelled', settled: 'cancelled' });

  // A purchase settles at once (the screen pops without waiting for the SDK's
  // dismissal request); a later dismiss changes nothing.
  const bought = run([{ type: 'purchase_completed' }]);
  assert.deepEqual(bought, { pending: 'purchased', settled: 'purchased' });
  assert.equal(reducePaywallRoute(bought, { type: 'dismiss' }), bought, 'settled is terminal');
  assert.equal(reducePaywallRoute(bought, { type: 'unmount' }), bought);
  assert.equal(reducePaywallRoute(bought, { type: 'purchase_error' }), bought);

  // An entitling restore settles as restored…
  assert.deepEqual(run([{ type: 'restore_completed', premium: true }]), { pending: 'restored', settled: 'restored' });
  // …a restore without the entitlement leaves the paywall up and grants nothing.
  const nothing = run([{ type: 'restore_completed', premium: false }]);
  assert.deepEqual(nothing, INITIAL_PAYWALL_ROUTE_STATE);
  assert.deepEqual(reducePaywallRoute(nothing, { type: 'dismiss' }), { pending: 'cancelled', settled: 'cancelled' });

  // RevenueCat's own semantics: a failed purchase then close → error; a
  // cancelled StoreKit sheet then close → cancelled; the last event wins.
  assert.deepEqual(run([{ type: 'purchase_error' }, { type: 'dismiss' }]), { pending: 'error', settled: 'error' });
  assert.deepEqual(run([{ type: 'purchase_cancelled' }, { type: 'dismiss' }]), { pending: 'cancelled', settled: 'cancelled' });
  assert.deepEqual(run([{ type: 'purchase_error' }, { type: 'purchase_cancelled' }, { type: 'dismiss' }]), {
    pending: 'cancelled',
    settled: 'cancelled',
  });
  assert.deepEqual(run([{ type: 'purchase_cancelled' }, { type: 'purchase_error' }, { type: 'dismiss' }]), {
    pending: 'error',
    settled: 'error',
  });
  // Retry after an error that succeeds → purchased.
  assert.deepEqual(run([{ type: 'purchase_error' }, { type: 'purchase_completed' }]), {
    pending: 'purchased',
    settled: 'purchased',
  });

  // The screen going away without a callback is always a cancel — even after
  // an error, nobody is sent to the fallback paywall for a screen they never closed.
  assert.deepEqual(run([{ type: 'unmount' }]), { pending: 'cancelled', settled: 'cancelled' });
  assert.deepEqual(run([{ type: 'purchase_error' }, { type: 'unmount' }]), { pending: 'error', settled: 'cancelled' });
}

// ---------------------------------------------------------------------------
// createPaywallRequestRegistry: one id per presentation, settled exactly once.

const offering = { identifier: 'default', availablePackages: [] } as unknown as Parameters<
  ReturnType<typeof createPaywallRequestRegistry>['open']
>[0]['offering'];

{
  let counter = 0;
  const registry = createPaywallRequestRegistry(() => `req-${(counter += 1)}`);
  assert.equal(registry.size, 0);
  assert.equal(registry.peek('req-1'), null);
  assert.equal(registry.has(null), false);
  assert.equal(registry.has(undefined), false);
  assert.equal(registry.settle('req-1', 'cancelled'), false, 'unknown ids settle nothing');

  const first = registry.open({ offering });
  assert.equal(first.id, 'req-1');
  assert.equal(registry.size, 1);
  assert.equal(registry.has(first.id), true);
  assert.deepEqual(registry.peek(first.id), { offering }, 'the screen reads the offering by id');

  let resolved: string | null = null;
  void first.promise.then((result) => {
    resolved = result;
  });
  await Promise.resolve();
  assert.equal(resolved, null, 'pending until the screen settles it');

  assert.equal(registry.settle(first.id, 'purchased'), true);
  await Promise.resolve();
  assert.equal(resolved, 'purchased');
  assert.equal(registry.size, 0, 'settled requests are dropped');
  assert.equal(registry.has(first.id), false);
  assert.equal(registry.peek(first.id), null);
  assert.equal(registry.settle(first.id, 'cancelled'), false, 'exactly once: a second settle is a no-op');
  await Promise.resolve();
  assert.equal(resolved, 'purchased', 'the first result stands');

  // Two requests in flight resolve independently, in any order.
  const second = registry.open({ offering: null });
  const third = registry.open({ offering });
  assert.equal(second.id, 'req-2');
  assert.equal(third.id, 'req-3');
  assert.equal(registry.size, 2);
  assert.deepEqual(registry.peek(second.id), { offering: null });
  const results: Record<string, string> = {};
  void second.promise.then((r) => {
    results.second = r;
  });
  void third.promise.then((r) => {
    results.third = r;
  });
  assert.equal(registry.settle(third.id, 'cancelled'), true);
  await Promise.resolve();
  assert.deepEqual(results, { third: 'cancelled' });
  assert.equal(registry.has(second.id), true, 'the other request is untouched');
  assert.equal(registry.settle(second.id, 'error'), true);
  await Promise.resolve();
  assert.deepEqual(results, { second: 'error', third: 'cancelled' });
  assert.equal(registry.size, 0);

  // Default id factory: unique, non-empty, safe in a query string.
  const defaults = createPaywallRequestRegistry();
  const a = defaults.open({ offering: null });
  const b = defaults.open({ offering: null });
  assert.notEqual(a.id, b.id);
  assert.ok(a.id.length > 0 && encodeURIComponent(a.id) === a.id, 'id survives the route param untouched');
  defaults.settle(a.id, 'cancelled');
  defaults.settle(b.id, 'cancelled');
  assert.equal(defaults.size, 0);
}

// The whole screen lifecycle, as the route drives it: reducer + registry.
{
  const registry = createPaywallRequestRegistry(() => 'lifecycle');
  const request = registry.open({ offering });
  let state: PaywallRouteState = INITIAL_PAYWALL_ROUTE_STATE;
  const screen = (event: PaywallRouteEvent) => {
    state = reducePaywallRoute(state, event);
    return state.settled === null ? false : registry.settle(request.id, state.settled);
  };
  assert.equal(screen({ type: 'purchase_cancelled' }), false, 'StoreKit sheet dismissed: paywall stays');
  assert.equal(screen({ type: 'purchase_error' }), false, 'a failed retry: paywall stays');
  assert.equal(screen({ type: 'purchase_completed' }), true, 'bought: settled now → the screen pops');
  assert.equal(screen({ type: 'dismiss' }), false, "the SDK's own dismissal afterwards is ignored");
  assert.equal(screen({ type: 'unmount' }), false, 'and so is the unmount');
  assert.equal(await request.promise, 'purchased');
  assert.equal(registry.size, 0);
}

console.log(
  'Paywall route replay passed: callbacks → SDK result (cancel, purchase, entitling/non-entitling restore, error-then-close, cancel-then-close, retry, unmount = cancelled), registry (ids, peek, settle exactly once, independent requests, default ids), screen lifecycle',
);
