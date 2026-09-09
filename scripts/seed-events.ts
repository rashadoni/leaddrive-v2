/**
 * Seed script: Create sample events with participants
 * Run: npx tsx scripts/seed-events.ts
 */
import type { PrismaClient } from "@prisma/client"
import { makeScriptPrisma } from "./_rls.mjs"

let prisma!: PrismaClient

const ORG_ID = "cmmxg74k10000td3rr37dl6am" // LeadDrive Inc.

async function main() {
  prisma = await makeScriptPrisma()
  console.log("Seeding events...")

  // Get some contacts to use as participants
  const contacts = await prisma.contact.findMany({
    where: { organizationId: ORG_ID },
    take: 20,
    select: { id: true, fullName: true, email: true, phone: true, companyId: true },
  })
  console.log(`Found ${contacts.length} contacts for participants`)

  const events = [
    {
      name: "IT Outsourcing Summit Baku 2026",
      description: "Annual summit for IT outsourcing companies in Azerbaijan and the region. Networking, panels, and workshops on emerging tech trends, AI-driven development, and remote team management.",
      type: "conference",
      status: "registration_open",
      startDate: new Date("2026-05-15T09:00:00"),
      endDate: new Date("2026-05-16T18:00:00"),
      location: "Hilton Baku, Azerbaijan",
      isOnline: false,
      budget: 25000,
      expectedRevenue: 40000,
      maxParticipants: 200,
      tags: ["outsourcing", "IT", "networking", "baku"],
    },
    {
      name: "Webinar: AI in Customer Support",
      description: "Free webinar about implementing AI chatbots and automated ticket routing in customer support. Live demo of our LeadDrive AI agent.",
      type: "webinar",
      status: "planned",
      startDate: new Date("2026-04-10T14:00:00"),
      endDate: new Date("2026-04-10T15:30:00"),
      location: "",
      isOnline: true,
      meetingUrl: "https://zoom.us/j/123456789",
      budget: 500,
      expectedRevenue: 0,
      maxParticipants: 100,
      tags: ["AI", "support", "chatbot", "webinar"],
    },
    {
      name: "Product Workshop: CRM Best Practices",
      description: "Hands-on workshop for clients on how to get the most out of LeadDrive CRM. Topics: pipeline management, automation, reporting, and integrations.",
      type: "workshop",
      status: "completed",
      startDate: new Date("2026-03-01T10:00:00"),
      endDate: new Date("2026-03-01T16:00:00"),
      location: "LeadDrive Office, Warsaw",
      isOnline: false,
      budget: 3000,
      actualCost: 2800,
      expectedRevenue: 5000,
      actualRevenue: 4500,
      maxParticipants: 30,
      tags: ["CRM", "workshop", "training"],
    },
    {
      name: "Azerbaijan Tech Meetup #12",
      description: "Monthly meetup for the Baku tech community. This month's topic: Microservices architecture and DevOps pipelines.",
      type: "meetup",
      status: "completed",
      startDate: new Date("2026-02-20T18:30:00"),
      endDate: new Date("2026-02-20T21:00:00"),
      location: "Startup Hub, Baku",
      isOnline: true,
      meetingUrl: "https://meet.google.com/xyz-abc-def",
      budget: 800,
      actualCost: 750,
      expectedRevenue: 0,
      actualRevenue: 0,
      maxParticipants: 50,
      tags: ["meetup", "tech", "devops", "microservices"],
    },
    {
      name: "InfoSec Exhibition 2026",
      description: "Exhibiting our security monitoring and compliance products at the InfoSec Azerbaijan expo.",
      type: "exhibition",
      status: "planned",
      startDate: new Date("2026-06-20T09:00:00"),
      endDate: new Date("2026-06-22T17:00:00"),
      location: "Expo Center, Baku",
      isOnline: false,
      budget: 15000,
      expectedRevenue: 25000,
      maxParticipants: 500,
      tags: ["security", "exhibition", "infosec"],
    },
  ]

  for (const eventData of events) {
    const { tags, ...rest } = eventData
    const event = await prisma.event.create({
      data: {
        ...rest,
        organizationId: ORG_ID,
        tags,
        registeredCount: 0,
        attendedCount: 0,
      },
    })

    // Add participants from contacts
    const participantCount = Math.min(contacts.length, Math.floor(Math.random() * 10) + 3)
    const selectedContacts = contacts.sort(() => Math.random() - 0.5).slice(0, participantCount)
    const roles = ["attendee", "attendee", "attendee", "speaker", "sponsor", "vip"]
    const statuses = eventData.status === "completed"
      ? ["attended", "attended", "attended", "no_show", "cancelled"]
      : ["registered", "registered", "confirmed", "confirmed"]

    let attended = 0
    for (const contact of selectedContacts) {
      const status = statuses[Math.floor(Math.random() * statuses.length)]
      if (status === "attended") attended++

      await prisma.eventParticipant.create({
        data: {
          eventId: event.id,
          contactId: contact.id,
          companyId: contact.companyId || undefined,
          name: contact.fullName,
          email: contact.email || undefined,
          phone: contact.phone || undefined,
          role: roles[Math.floor(Math.random() * roles.length)],
          status,
        },
      })
    }

    // Update counts
    await prisma.event.update({
      where: { id: event.id },
      data: {
        registeredCount: selectedContacts.length,
        attendedCount: attended,
      },
    })

    console.log(`  Created: ${event.name} (${selectedContacts.length} participants, ${attended} attended)`)
  }

  console.log("\nDone! Created 5 events with participants.")
}

main().catch(console.error).finally(() => prisma.$disconnect())
