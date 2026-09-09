import { MtmContactDetail } from "@/components/mtm/contact-detail"

export default async function MtmContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <MtmContactDetail contactId={id} />
}
