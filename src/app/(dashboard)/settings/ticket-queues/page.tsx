import { redirect } from "next/navigation"

// Ticket queues moved into the Support module's Skill Routing hub (agent skills + queues together).
// Keep this route as a redirect so old links / bookmarks still land in the right place.
export default function TicketQueuesRedirect() {
  redirect("/support/skill-routing")
}
