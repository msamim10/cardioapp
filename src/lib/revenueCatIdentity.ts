export type RevenueCatIdentityAdapter<T> = {
  getAppUserID: () => Promise<string>;
  getCustomerInfo: () => Promise<T>;
  isAnonymous: () => Promise<boolean>;
  logIn: (uid: string) => Promise<T>;
  logOut: () => Promise<T>;
};

export type RevenueCatIdentityState<T> = {
  applied: string | null | undefined;
  inFlight: Promise<T | null> | null;
  lastCustomerInfo: T | null;
  requested: string | null | undefined;
};

export function createRevenueCatIdentityState<T>(): RevenueCatIdentityState<T> {
  return {
    applied: undefined,
    inFlight: null,
    lastCustomerInfo: null,
    requested: undefined,
  };
}

async function applyIdentity<T>(
  adapter: RevenueCatIdentityAdapter<T>,
  uid: string | null,
): Promise<T> {
  if (uid) {
    const currentAppUserID = await adapter.getAppUserID();
    return currentAppUserID === uid
      ? adapter.getCustomerInfo()
      : adapter.logIn(uid);
  }

  return (await adapter.isAnonymous())
    ? adapter.getCustomerInfo()
    : adapter.logOut();
}

/**
 * Serializes Firebase-to-RevenueCat identity changes and coalesces repeated
 * auth events. The state may be retained on globalThis so Fast Refresh and
 * provider remounts share the same in-flight operation and last applied UID.
 */
export function synchronizeRevenueCatIdentity<T>(
  adapter: RevenueCatIdentityAdapter<T>,
  uid: string | null,
  state: RevenueCatIdentityState<T>,
): Promise<T | null> {
  state.requested = uid;

  if (state.applied === uid && !state.inFlight) {
    return Promise.resolve(state.lastCustomerInfo);
  }
  if (state.inFlight) return state.inFlight;

  state.inFlight = (async () => {
    let result = state.lastCustomerInfo;
    while (state.requested !== state.applied) {
      const requested = state.requested;
      if (requested === undefined) break;
      result = await applyIdentity(adapter, requested);
      state.lastCustomerInfo = result;
      state.applied = requested;
    }
    return result;
  })().finally(() => {
    state.inFlight = null;
  });

  return state.inFlight;
}
