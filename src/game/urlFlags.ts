export function readUrlFlags(): {
  debug: boolean;
  debugScene: boolean;
  startSandbox: boolean;
} {
  const params = new URLSearchParams(
    typeof window === 'undefined' ? '' : window.location.search,
  );
  const debugParam = params.get('debug') === '1';
  const debug = Boolean(import.meta.env.DEV) || debugParam;
  return {
    debug,
    debugScene: debugParam && params.get('debugScene') === '1',
    startSandbox: debug && params.get('start') === 'sandbox',
  };
}
