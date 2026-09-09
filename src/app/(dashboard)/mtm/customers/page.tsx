"use client"

import { useSession } from "next-auth/react"
import { MtmOrganizationExplorer } from "@/components/mtm/organization-explorer"

export default function MtmCustomersPage() {
  const { data: session } = useSession()
  const orgId = session?.user?.organizationId
  return <MtmOrganizationExplorer orgId={orgId ? String(orgId) : undefined} />
}
