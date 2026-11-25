import { PortalContractView } from "@/components/portal/portal-documents"

/** One contract of the counterparty's company with its documents (src/lib/portal-documents.ts). */
export default async function PortalContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <PortalContractView contractId={id} />
}
