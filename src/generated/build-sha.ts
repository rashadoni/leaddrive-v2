// Overwritten by .github/workflows/deploy.yml immediately before `next build`,
// so the revision is compiled INTO the bundle rather than read from disk.
//
// That distinction is the whole point: a marker file next to server.js proves
// which files were unpacked, while this constant travels inside the JavaScript
// the running process actually loaded. A process that somehow survived a swap
// would keep reporting its own (old) revision instead of reading the new file
// and claiming to be something it is not.
//
// Empty in local development and in any build made outside the deploy workflow.
export const DEPLOY_SHA = ""
export const BUILT_AT = ""
