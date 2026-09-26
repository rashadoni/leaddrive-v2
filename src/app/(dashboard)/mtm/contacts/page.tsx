import { MtmContactExplorer } from "@/components/mtm/contact-explorer"
import { FieldContactsGate } from "@/components/mtm/field-contacts-gate"
import { ContactCreateRequestQueue } from "@/components/mtm/contact-create-request-queue"

export default function MtmContactsPage() {
  return (
    <FieldContactsGate>
      <>
        <ContactCreateRequestQueue />
        <MtmContactExplorer />
      </>
    </FieldContactsGate>
  )
}
