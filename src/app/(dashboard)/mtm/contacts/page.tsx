import { MtmContactExplorer } from "@/components/mtm/contact-explorer"
import { FieldContactsGate } from "@/components/mtm/field-contacts-gate"
import { ContactCreateRequestQueue } from "@/components/mtm/contact-create-request-queue"
import { MTM_CONTACT_REQUESTS_PARAM, contactRequestsAsked } from "@/lib/mtm/contact-create-request-link"

export default async function MtmContactsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { [MTM_CONTACT_REQUESTS_PARAM]: requests } = await searchParams
  return (
    <FieldContactsGate>
      <>
        <ContactCreateRequestQueue openOnArrival={contactRequestsAsked(requests)} />
        <MtmContactExplorer />
      </>
    </FieldContactsGate>
  )
}
