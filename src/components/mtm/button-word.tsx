"use client"

import { useTranslations } from "next-intl"

export type MtmWordKey =
  | "edit" | "more" | "delete" | "close" | "up" | "down"
  | "previous" | "next" | "save" | "refresh" | "download" | "plan"

/**
 * The word on an MTM button (owner: «кнопка со словами» — an icon alone is
 * not read as an action). One dictionary, so «Sil» is «Sil» on every page;
 * the button keeps its full aria-label for a screen reader.
 */
export function MtmWord({ word }: { word: MtmWordKey }) {
  const t = useTranslations("mtmWords")
  return <>{t(word)}</>
}
