/** The company fields an outside register owns (Zeytun's 1C pharmacy list);
 * the company form and API refuse to change them on such a company. */
export const PHARMACY_SOURCE_FIELDS = ["name", "address", "city", "phone"] as const
