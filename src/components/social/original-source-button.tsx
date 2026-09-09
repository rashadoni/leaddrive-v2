"use client"

import { ChevronDown, Copy, ExternalLink } from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { copyTextWithFallback, facebookMobileUrl } from "@/lib/social/external-source-links"

export function OriginalSourceButton({ url, label }: { url: string; label: string }) {
  const t = useTranslations("socialMonitoring")
  const mobileFacebookUrl = facebookMobileUrl(url)

  const copyLink = async () => {
    try {
      if (!await copyTextWithFallback(url)) throw new Error("Copy failed")
      toast.success(t("originalLinkCopied"))
    } catch {
      toast.error(t("originalLinkCopyFailed"))
    }
  }

  return (
    <div className="inline-flex items-stretch">
      <Button asChild size="sm" className="h-11 gap-1.5 rounded-r-none pr-2 text-xs sm:h-8">
        <a href={url} target="_blank" rel="noopener noreferrer">
          <ExternalLink className="h-3.5 w-3.5" /> {label}
        </a>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="sm"
            className="h-11 w-11 rounded-l-none border-l border-primary-foreground/25 px-0 sm:h-8 sm:w-8"
            aria-label={t("originalLinkOptions")}
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[15rem]">
          {mobileFacebookUrl && (
            <DropdownMenuItem asChild>
              <a href={mobileFacebookUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" />
                {t("openFacebookMobile")}
              </a>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => void copyLink()}>
            <Copy className="mr-2 h-4 w-4" />
            {t("copyOriginalLink")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
