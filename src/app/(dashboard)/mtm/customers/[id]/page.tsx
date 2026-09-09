import { MtmOrganizationDetail } from "@/components/mtm/organization-detail"

export default async function MtmOrganizationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <MtmOrganizationDetail organizationId={id} />
}
