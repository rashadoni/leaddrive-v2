/**
 * Going from a sign-in page into the CRM is a full page load, on purpose.
 *
 * What a page may ask the browser for (microphone, location) is fixed by the
 * response that loaded the document, and in-app navigation never changes it.
 * The sign-in pages are answered with `microphone=()`, the CRM with
 * `microphone=(self)`. Entering with `router.push` kept the sign-in page's
 * document, so everyone who had just signed in got "the browser did not allow
 * the microphone" until they happened to reload, whatever the site permission
 * said (owner, 2026-11-22, on two organizations in a row).
 */
export function enterSignedInApp(location: Pick<Location, "assign"> = window.location): void {
  location.assign("/")
}
