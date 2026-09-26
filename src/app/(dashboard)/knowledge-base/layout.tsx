import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Knowledge Base · LeadDrive CRM",
}

export default function KnowledgeBaseLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children
}
