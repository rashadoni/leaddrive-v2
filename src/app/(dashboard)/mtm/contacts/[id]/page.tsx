import { MtmContactDetail } from "@/components/mtm/contact-detail"
import { FieldContactsGate } from "@/components/mtm/field-contacts-gate"

export default async function MtmContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return (
    <FieldContactsGate>
      <MtmContactDetail contactId={id} />
    </FieldContactsGate>
  )
}
