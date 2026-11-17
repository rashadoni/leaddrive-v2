/**
 * A supplier is a company of this category (docs/sales-procurement/README.md,
 * decision 6.3): one table for everyone a company deals with, so a supplier
 * keeps contacts, files and history like a client does.
 */
export const SUPPLIER_CATEGORY = "supplier" as const

/**
 * Categories the customer lists leave out unless asked for by name: partners
 * (as before) and suppliers — the people we buy from are not prospects or
 * clients, and counting them there would skew every customer figure.
 */
export const NON_CUSTOMER_COMPANY_CATEGORIES = ["partner", SUPPLIER_CATEGORY] as const
