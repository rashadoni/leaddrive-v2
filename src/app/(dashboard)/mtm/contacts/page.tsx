import { MtmContactExplorer } from "@/components/mtm/contact-explorer"
import { FieldContactsGate } from "@/components/mtm/field-contacts-gate"

export default function MtmContactsPage() {
  return (
    <FieldContactsGate>
      <MtmContactExplorer />
    </FieldContactsGate>
  )
}
