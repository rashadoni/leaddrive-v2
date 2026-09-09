/**
 * Shared loyalty tier badge colors + helper.
 *
 * Single source for the bronze→diamond badge styling used across the loyalty
 * surfaces (Builder preview panel, member portal, Builder "Members" tab). This
 * is a pure constants leaf — no prisma / server imports — so client components
 * can import it without a client-build hazard (see feedback_client_build_boundary).
 */
export const TIER_COLORS: Record<string, string> = {
  bronze: "bg-amber-700 text-white",
  silver: "bg-slate-400 text-white",
  gold: "bg-yellow-500 text-white",
  platinum: "bg-purple-500 text-white",
  diamond: "bg-cyan-500 text-white",
}

/** Badge class for a tier slug, falling back to a neutral chip for null/unknown. */
export const tierColor = (code: string | null): string =>
  (code && TIER_COLORS[code]) || "bg-muted text-foreground"
