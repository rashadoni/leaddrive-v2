import Link from "next/link"
import { useTranslations } from "next-intl"

import { cn } from "@/lib/utils"

/** The two views of phone orders: the orders and the pharmacies they come from. */
export function PhoneOrdersViews({ active }: { active: "orders" | "pharmacies" }) {
  const t = useTranslations("pharmacyPhoneOrders")
  const views = [{ key: "orders", href: "/pharmacy-orders" }, { key: "pharmacies", href: "/pharmacy-orders/pharmacies" }] as const
  return (
    <div className="flex w-fit gap-1 rounded-lg bg-muted/60 p-1 text-sm">
      {views.map(view => (
        <Link key={view.key} href={view.href}
          className={cn("rounded-md px-3 py-1.5", active === view.key ? "bg-card font-semibold shadow-sm" : "text-muted-foreground hover:text-foreground")}>
          {t(view.key === "orders" ? "viewOrders" : "viewPharmacies")}
        </Link>
      ))}
    </div>
  )
}
