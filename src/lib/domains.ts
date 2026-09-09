export const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.leaddrivecrm.org"
export const MARKETING_URL = process.env.NEXT_PUBLIC_MARKETING_URL || "https://leaddrivecrm.org"
/** Domain without protocol, e.g. "app.leaddrivecrm.org" */
export const APP_DOMAIN = APP_URL.replace(/^https?:\/\//, "")
/** Domain without protocol, e.g. "leaddrivecrm.org" */
export const MARKETING_DOMAIN = MARKETING_URL.replace(/^https?:\/\//, "")
