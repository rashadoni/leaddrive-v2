import { ContractDocumentEditor } from "@/components/contracts/contract-document-editor"

/** A price protocol or an acceptance act of a contract (src/lib/clm/contract-documents.ts). */
export default async function ContractDocumentPage({ params }: { params: Promise<{ id: string; docId: string }> }) {
  const { id, docId } = await params
  return <ContractDocumentEditor contractId={id} docId={docId} />
}
