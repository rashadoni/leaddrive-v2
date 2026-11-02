import Link from "next/link"
import { useTranslations } from "next-intl"

import { cn } from "@/lib/utils"

const VIEWS = [
  { key: "orders", href: "/pharmacy-orders", label: "viewOrders" },
  { key: "pharmacies", href: "/pharmacy-orders/pharmacies", label: "viewPharmacies" },
  { key: "speech", href: "/pharmacy-orders/speech", label: "viewSpeech" },
] as const

/** The views of phone orders: the orders, the pharmacies they come from, what the line says. */
export function PhoneOrdersViews({ active }: { active: (typeof VIEWS)[number]["key"] }) {
  const t = useTranslations("pharmacyPhoneOrders")
  const views = VIEWS
  return (
    <div className="flex w-fit gap-1 rounded-lg bg-muted/60 p-1 text-sm">
      {views.map(view => (
        <Link key={view.key} href={view.href}
          className={cn("rounded-md px-3 py-1.5", active === view.key ? "bg-card font-semibold shadow-sm" : "text-muted-foreground hover:text-foreground")}>
          {t(view.label)}
        </Link>
      ))}
    </div>
  )
}
