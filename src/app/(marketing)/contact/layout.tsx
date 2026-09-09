import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Əlaqə",
  description: "LeadDrive CRM komandası ilə əlaqə saxlayın. Suallarınız, demo tələbləri və əməkdaşlıq üçün bizimlə əlaqə saxlayın.",
  openGraph: {
    title: "Əlaqə | LeadDrive CRM",
    description: "Suallarınız üçün bizimlə əlaqə saxlayın. Bakı, Azərbaycan.",
  },
}

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return children
}
