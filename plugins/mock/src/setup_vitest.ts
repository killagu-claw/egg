import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';

import { mock, type MockApplication } from './index.ts';

// Provide Mocha-compatible aliases so existing tests using before/after still work
// Vitest globals only inject beforeAll/afterAll, not Mocha's before/after
const g = globalThis as Record<string, unknown>;
if (!g.before) g.before = beforeAll;
if (!g.after) g.after = afterAll;
if (!g.beforeEach) g.beforeEach = beforeEach;
if (!g.afterEach) g.afterEach = afterEach;

// Signal that vitest setup is handling the lifecycle hooks,
// so setupApp() in app_handler.ts should skip registering duplicate hooks
(globalThis as Record<string, unknown>).__eggMockVitestSetup = true;

// Auto-configure @eggjs/tegg-vitest runner for context injection.
// The runner checks __teggVitestConfig to decide whether to create
// per-test tegg module scopes (so app.currentContext is available).
// Tegg scope creation is handled exclusively by the runner, not here.
if (!(globalThis as Record<string, unknown>).__teggVitestConfig) {
  (globalThis as Record<string, unknown>).__teggVitestConfig = {
    restoreMocks: true,
    getApp: async () => {
      const bootstrap = await import('./bootstrap.ts');
      return (bootstrap as any)?.app;
    },
  };
}

let app: MockApplication | undefined;

// Cache the startup promise so that:
// 1. Only one startup attempt is made per worker
// 2. If startup fails, subsequent test files fail immediately
// 3. If startup hangs, all files share the same pending promise
let startupPromise: Promise<void> | undefined;

beforeAll(async () => {
  if (!startupPromise) {
    startupPromise = (async () => {
      const { app: bootstrapApp } = await import('./bootstrap.ts');
      app = bootstrapApp;
      await app.ready();
    })();
    // Prevent unhandled promise rejection when startup fails
    // (the error will be re-thrown via await in each beforeAll)
    startupPromise.catch(() => {});
  }
  await startupPromise;
});

afterEach(async () => {
  if (app && typeof app.backgroundTasksFinished === 'function') {
    await app.backgroundTasksFinished();
  }
  await mock.restore();
});

afterAll(async () => {
  // When vitest runs without isolation (isolate: false), the app is shared
  // across all test files in the same worker. afterAll still fires per-file,
  // so closing the app here would destroy tegg runtime state (LoadUnitInstances)
  // and cause subsequent files to fail with "not found load unit for proto".
  // Worker thread termination handles cleanup when the test run finishes.
  const sharedMode =
    (globalThis as Record<string, unknown>).__eggVitestSharedMode || process.env.EGG_VITEST_ISOLATE === 'false';
  if (sharedMode) return;
  if (app) await app.close();
});
