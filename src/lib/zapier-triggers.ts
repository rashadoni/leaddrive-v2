interface ZapierTriggerCatalogEntry {
  key: string
  label: string
  description: string
  required_scopes: string[]
}

export const ZAPIER_TRIGGER_CATALOG: ZapierTriggerCatalogEntry[] = [
  { key: "lead.created", label: "New Lead", description: "Fires when a new lead is created", required_scopes: ["read:leads"] },
  { key: "lead.updated", label: "Lead Updated", description: "Fires when a lead is updated", required_scopes: ["read:leads"] },
  { key: "lead.converted", label: "Lead Converted", description: "Fires when a lead is converted to a deal", required_scopes: ["read:leads"] },

  { key: "contact.created", label: "New Contact", description: "Fires when a new contact is created", required_scopes: ["read:contacts"] },
  { key: "contact.updated", label: "Contact Updated", description: "Fires when a contact is updated", required_scopes: ["read:contacts"] },

  { key: "company.created", label: "New Company", description: "Fires when a new company is created", required_scopes: ["read:companies"] },
  { key: "company.updated", label: "Company Updated", description: "Fires when a company is updated", required_scopes: ["read:companies"] },

  { key: "deal.created", label: "New Deal", description: "Fires when a new deal is created", required_scopes: ["read:deals"] },
  { key: "deal.updated", label: "Deal Updated", description: "Fires when a deal is updated", required_scopes: ["read:deals"] },
  { key: "deal.stage_changed", label: "Deal Stage Changed", description: "Fires when a deal moves to a new stage", required_scopes: ["read:deals"] },
  { key: "deal.won", label: "Deal Won", description: "Fires when a deal is marked won", required_scopes: ["read:deals"] },
  { key: "deal.lost", label: "Deal Lost", description: "Fires when a deal is marked lost", required_scopes: ["read:deals"] },

  { key: "ticket.created", label: "New Ticket", description: "Fires when a new support ticket is created", required_scopes: ["read:tickets"] },
  { key: "ticket.updated", label: "Ticket Updated", description: "Fires when a ticket is updated", required_scopes: ["read:tickets"] },
  { key: "ticket.resolved", label: "Ticket Resolved", description: "Fires when a ticket is marked resolved", required_scopes: ["read:tickets"] },

  { key: "task.created", label: "New Task", description: "Fires when a new task is created", required_scopes: ["read:tasks"] },
  { key: "task.completed", label: "Task Completed", description: "Fires when a task is completed", required_scopes: ["read:tasks"] },

  { key: "campaign.sent", label: "Campaign Sent", description: "Fires when a campaign is dispatched", required_scopes: ["read:campaigns"] },
]

export const ZAPIER_TRIGGER_KEYS = new Set(ZAPIER_TRIGGER_CATALOG.map((trigger) => trigger.key))
