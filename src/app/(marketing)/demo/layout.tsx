import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Demo Tələb Et",
  description: "LeadDrive CRM-in 128+ funksiyasını 14 gün pulsuz sınayın. Demo tələb edin — komandamız sizə kömək edəcək.",
  openGraph: {
    title: "Demo Tələb Et | LeadDrive CRM",
    description: "128+ funksiya, 16 Da Vinci inteqrasiya. 14 gün pulsuz sınaq — kredit kartı tələb olunmur.",
  },
}

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return children
}
