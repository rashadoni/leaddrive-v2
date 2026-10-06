// Fixture-only worker: no content script, request interception or app data.
globalThis.chrome.runtime.onInstalled.addListener(() => undefined)
