// &asMac=1 (branch m5-spike only): React Aria decides ⌘ = move from the platform it reads once; give it a Mac's before it asks.
if (new URLSearchParams(location.search).get('asMac') === '1') {
  Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel', configurable: true });
  Object.defineProperty(navigator, 'userAgentData', { get: () => ({ platform: 'macOS', brands: [], mobile: false }), configurable: true });
}
