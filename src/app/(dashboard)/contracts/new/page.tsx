import { ContractWizardScreen } from "@/components/contracts/contract-wizard"

/** «Yeni müqavilə» — the contract wizard; `?deal=<id>` brings the deal's company and money along. */
export default async function NewContractPage({ searchParams }: { searchParams: Promise<{ deal?: string | string[] }> }) {
  const { deal } = await searchParams
  return <ContractWizardScreen dealId={typeof deal === "string" && deal ? deal : null} />
}
