/**
 * Loading the wall screen again, as one call.
 *
 * Apart from the page so a test can stand in for it: jsdom does not let
 * `location.reload` be watched, and what has to be proven is WHEN the screen
 * decides to reload, not that a browser can.
 */
export function reloadBoardPage(): void {
  window.location.reload()
}
