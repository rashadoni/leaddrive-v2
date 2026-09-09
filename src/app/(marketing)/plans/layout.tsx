import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Qiymətlər və Planlar",
  description: "LeadDrive CRM planları — Starter, Business, Professional, Enterprise. Pulsuz başlayın, hazır olanda yüksəldin.",
  openGraph: {
    title: "Qiymətlər və Planlar | LeadDrive CRM",
    description: "Sizinlə birlikdə böyüyən planlar. Gizli ödənişlər yoxdur.",
  },
}

export default function PlansLayout({ children }: { children: React.ReactNode }) {
  return children
}
