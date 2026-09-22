import { expect, test } from 'vitest';

// M0 smoke test: simulation tests must run headlessly, without a DOM shim.
test('simulation test environment is headless', () => {
  expect('window' in globalThis).toBe(false);
  expect('document' in globalThis).toBe(false);
});
