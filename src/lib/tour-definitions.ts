/**
 * Tour definitions for guided onboarding.
 * Each tour has an id matching a page/section, and an array of steps.
 * Steps reference DOM elements via data-tour-id attributes.
 * titleKey/descKey resolve to i18n keys under "tour.{tourId}.{key}".
 */

interface TourStepDef {
  targetId: string   // matches data-tour-id="xxx" on the page
  titleKey: string   // i18n key for title (under tour.{tourId})
  descKey: string    // i18n key for description
}

interface TourDef {
  steps: TourStepDef[]
}

export const TOUR_DEFINITIONS: Record<string, TourDef> = {
  // ── Inbox — chatbot auto-reply ──
  chatbotRules: {
    steps: [
      { targetId: "cb-master", titleKey: "masterTitle", descKey: "masterDesc" },
      { targetId: "cb-form", titleKey: "formTitle", descKey: "formDesc" },
      { targetId: "cb-trigger", titleKey: "triggerTitle", descKey: "triggerDesc" },
      { targetId: "cb-channels", titleKey: "channelsTitle", descKey: "channelsDesc" },
      { targetId: "cb-rules", titleKey: "rulesTitle", descKey: "rulesDesc" },
    ],
  },

  // ── Phase 1 ──

  dashboard: {
    steps: [
      { targetId: "app-launcher", titleKey: "launcherTitle", descKey: "launcherDesc" },
      { targetId: "dashboard-stats", titleKey: "statsTitle", descKey: "statsDesc" },
      { targetId: "dashboard-pipeline", titleKey: "pipelineTitle", descKey: "pipelineDesc" },
      { targetId: "dashboard-activity", titleKey: "activityTitle", descKey: "activityDesc" },
    ],
  },

  deals: {
    steps: [
      { targetId: "deals-kanban", titleKey: "kanbanTitle", descKey: "kanbanDesc" },
      { targetId: "deals-pipeline-select", titleKey: "pipelineTitle", descKey: "pipelineDesc" },
      { targetId: "deals-summary", titleKey: "summaryTitle", descKey: "summaryDesc" },
      { targetId: "deals-card", titleKey: "cardTitle", descKey: "cardDesc" },
      { targetId: "deals-new", titleKey: "newTitle", descKey: "newDesc" },
    ],
  },

  dealDetail: {
    steps: [
      { targetId: "deal-stage-progress", titleKey: "stageTitle", descKey: "stageDesc" },
      { targetId: "deal-ai-prediction", titleKey: "aiPredTitle", descKey: "aiPredDesc" },
      { targetId: "deal-ai-suggestions", titleKey: "aiSugTitle", descKey: "aiSugDesc" },
      { targetId: "deal-quick-actions", titleKey: "quickTitle", descKey: "quickDesc" },
      { targetId: "deal-sidebar", titleKey: "sidebarTitle", descKey: "sidebarDesc" },
      { targetId: "deal-timeline", titleKey: "timelineTitle", descKey: "timelineDesc" },
    ],
  },

  tickets: {
    steps: [
      { targetId: "tickets-list", titleKey: "listTitle", descKey: "listDesc" },
      { targetId: "tickets-sla", titleKey: "slaTitle", descKey: "slaDesc" },
      { targetId: "tickets-kanban-toggle", titleKey: "kanbanTitle", descKey: "kanbanDesc" },
      { targetId: "tickets-new", titleKey: "newTitle", descKey: "newDesc" },
    ],
  },

  ticketDetail: {
    steps: [
      { targetId: "ticket-header-sla", titleKey: "headerTitle", descKey: "headerDesc" },
      { targetId: "ticket-ai-draft", titleKey: "aiDraftTitle", descKey: "aiDraftDesc" },
      { targetId: "ticket-ai-summary", titleKey: "aiSummaryTitle", descKey: "aiSummaryDesc" },
      { targetId: "ticket-ai-steps", titleKey: "aiStepsTitle", descKey: "aiStepsDesc" },
      { targetId: "ticket-comments", titleKey: "commentsTitle", descKey: "commentsDesc" },
      { targetId: "ticket-macros", titleKey: "macrosTitle", descKey: "macrosDesc" },
    ],
  },

  leads: {
    steps: [
      { targetId: "leads-list", titleKey: "listTitle", descKey: "listDesc" },
      { targetId: "leads-score", titleKey: "scoreTitle", descKey: "scoreDesc" },
      { targetId: "leads-status-filter", titleKey: "statusTitle", descKey: "statusDesc" },
      { targetId: "leads-convert", titleKey: "convertTitle", descKey: "convertDesc" },
    ],
  },

  reports: {
    steps: [
      { targetId: "reports-kpi", titleKey: "kpiTitle", descKey: "kpiDesc" },
      { targetId: "reports-pipeline-funnel", titleKey: "funnelTitle", descKey: "funnelDesc" },
      { targetId: "reports-lead-funnel", titleKey: "leadFunnelTitle", descKey: "leadFunnelDesc" },
      { targetId: "reports-forecast", titleKey: "forecastTitle", descKey: "forecastDesc" },
      { targetId: "reports-ai-commentary", titleKey: "aiComTitle", descKey: "aiComDesc" },
    ],
  },

  // ── Phase 2: Communications ──

  inbox: {
    steps: [
      { targetId: "inbox-channels", titleKey: "channelsTitle", descKey: "channelsDesc" },
      { targetId: "inbox-stats", titleKey: "statsTitle", descKey: "statsDesc" },
      { targetId: "inbox-conversations", titleKey: "convTitle", descKey: "convDesc" },
      { targetId: "inbox-thread", titleKey: "threadTitle", descKey: "threadDesc" },
    ],
  },

  campaigns: {
    steps: [
      { targetId: "campaigns-stats", titleKey: "statsTitle", descKey: "statsDesc" },
      { targetId: "campaigns-new", titleKey: "newTitle", descKey: "newDesc" },
      { targetId: "campaigns-list", titleKey: "listTitle", descKey: "listDesc" },
    ],
  },

  journeys: {
    steps: [
      { targetId: "journeys-header", titleKey: "headerTitle", descKey: "headerDesc" },
      { targetId: "journeys-list", titleKey: "listTitle", descKey: "listDesc" },
      { targetId: "journeys-new", titleKey: "newTitle", descKey: "newDesc" },
    ],
  },

  segments: {
    steps: [
      { targetId: "segments-filters", titleKey: "filtersTitle", descKey: "filtersDesc" },
      { targetId: "segments-new", titleKey: "newTitle", descKey: "newDesc" },
      { targetId: "segments-list", titleKey: "listTitle", descKey: "listDesc" },
    ],
  },

  // ── Phase 2: Finance ──

  invoices: {
    steps: [
      { targetId: "invoices-stats", titleKey: "statsTitle", descKey: "statsDesc" },
      { targetId: "invoices-new", titleKey: "newTitle", descKey: "newDesc" },
      { targetId: "invoices-list", titleKey: "listTitle", descKey: "listDesc" },
    ],
  },

  finance: {
    steps: [
      { targetId: "finance-tabs", titleKey: "tabsTitle", descKey: "tabsDesc" },
      { targetId: "finance-overview", titleKey: "overviewTitle", descKey: "overviewDesc" },
      { targetId: "finance-ar", titleKey: "arTitle", descKey: "arDesc" },
    ],
  },


  profitability: {
    steps: [
      { targetId: "profitability-kpi", titleKey: "kpiTitle", descKey: "kpiDesc" },
      { targetId: "profitability-tabs", titleKey: "tabsTitle", descKey: "tabsDesc" },
      { targetId: "profitability-charts", titleKey: "chartsTitle", descKey: "chartsDesc" },
    ],
  },

  pricing: {
    steps: [
      { targetId: "pricing-header", titleKey: "headerTitle", descKey: "headerDesc" },
      { targetId: "pricing-tabs", titleKey: "tabsTitle", descKey: "tabsDesc" },
    ],
  },

  // ── Phase 3: Other modules ──

  companies: {
    steps: [
      { targetId: "companies-stats", titleKey: "statsTitle", descKey: "statsDesc" },
      { targetId: "companies-new", titleKey: "newTitle", descKey: "newDesc" },
      { targetId: "companies-list", titleKey: "listTitle", descKey: "listDesc" },
    ],
  },

  companyDetail: {
    steps: [
      { targetId: "company-kpi", titleKey: "kpiTitle", descKey: "kpiDesc" },
      { targetId: "company-tabs", titleKey: "tabsTitle", descKey: "tabsDesc" },
    ],
  },

  contacts: {
    steps: [
      { targetId: "contacts-stats", titleKey: "statsTitle", descKey: "statsDesc" },
      { targetId: "contacts-new", titleKey: "newTitle", descKey: "newDesc" },
    ],
  },

  contactDetail: {
    steps: [
      { targetId: "contact-kpi", titleKey: "kpiTitle", descKey: "kpiDesc" },
      { targetId: "contact-comm", titleKey: "commTitle", descKey: "commDesc" },
    ],
  },

  tasks: {
    steps: [
      { targetId: "tasks-stats", titleKey: "statsTitle", descKey: "statsDesc" },
      { targetId: "tasks-views", titleKey: "viewsTitle", descKey: "viewsDesc" },
      { targetId: "tasks-new", titleKey: "newTitle", descKey: "newDesc" },
    ],
  },

  taskDetail: {
    steps: [
      { targetId: "task-status", titleKey: "statusTitle", descKey: "statusDesc" },
    ],
  },

  projects: {
    steps: [
      { targetId: "projects-new", titleKey: "newTitle", descKey: "newDesc" },
      { targetId: "projects-list", titleKey: "listTitle", descKey: "listDesc" },
    ],
  },

  projectDetail: {
    steps: [
      { targetId: "project-tabs", titleKey: "tabsTitle", descKey: "tabsDesc" },
    ],
  },

  knowledgeBase: {
    steps: [
      { targetId: "kb-new", titleKey: "newTitle", descKey: "newDesc" },
      { targetId: "kb-categories", titleKey: "catTitle", descKey: "catDesc" },
    ],
  },

  contracts: {
    steps: [
      { targetId: "contracts-stats", titleKey: "statsTitle", descKey: "statsDesc" },
      { targetId: "contracts-new", titleKey: "newTitle", descKey: "newDesc" },
    ],
  },

  contractTemplates: {
    steps: [
      { targetId: "ct-header", titleKey: "headerTitle", descKey: "headerDesc" },
      { targetId: "ct-tabs", titleKey: "tabsTitle", descKey: "tabsDesc" },
      { targetId: "ct-new-template", titleKey: "newTemplateTitle", descKey: "newTemplateDesc" },
      { targetId: "ct-clause-library", titleKey: "clauseLibTitle", descKey: "clauseLibDesc" },
    ],
  },

  contractLifecycle: {
    steps: [
      { targetId: "lifecycle-header", titleKey: "headerTitle", descKey: "headerDesc" },
      { targetId: "lifecycle-kpis", titleKey: "kpisTitle", descKey: "kpisDesc" },
    ],
  },

  offers: {
    steps: [
      { targetId: "offers-stats", titleKey: "statsTitle", descKey: "statsDesc" },
      { targetId: "offers-new", titleKey: "newTitle", descKey: "newDesc" },
    ],
  },

  // ── Phase 5: Marketing add-ons (D-track) ──

  loyalty: {
    steps: [
      { targetId: "loyalty-kpis", titleKey: "kpisTitle", descKey: "kpisDesc" },
      { targetId: "loyalty-tiers", titleKey: "tiersTitle", descKey: "tiersDesc" },
      { targetId: "loyalty-top-members", titleKey: "topMembersTitle", descKey: "topMembersDesc" },
      { targetId: "loyalty-recent-tx", titleKey: "recentTxTitle", descKey: "recentTxDesc" },
    ],
  },

  // The unified Loyalty Builder (admin setup screen)
  loyaltyBuilder: {
    steps: [
      { targetId: "lb-tabs", titleKey: "tabsTitle", descKey: "tabsDesc" },
      { targetId: "lb-quickstart", titleKey: "quickstartTitle", descKey: "quickstartDesc" },
      { targetId: "lb-preview", titleKey: "previewTitle", descKey: "previewDesc" },
      { targetId: "lb-portal-toggle", titleKey: "portalToggleTitle", descKey: "portalToggleDesc" },
    ],
  },

  // ── Phase 4: Settings ──

  settingsHub: { steps: [
    { targetId: "settings-grid", titleKey: "gridTitle", descKey: "gridDesc" },
  ]},
  apiKeys: { steps: [
    { targetId: "api-keys-header", titleKey: "headerTitle", descKey: "headerDesc" },
    { targetId: "api-keys-new", titleKey: "newTitle", descKey: "newDesc" },
    { targetId: "api-keys-list", titleKey: "listTitle", descKey: "listDesc" },
  ]},
  smtpSettings: { steps: [
    { targetId: "smtp-header", titleKey: "headerTitle", descKey: "headerDesc" },
    { targetId: "smtp-managed-email", titleKey: "managedTitle", descKey: "managedDesc" },
    { targetId: "smtp-presets", titleKey: "presetsTitle", descKey: "presetsDesc" },
    { targetId: "smtp-credentials", titleKey: "credentialsTitle", descKey: "credentialsDesc" },
    { targetId: "smtp-test-email", titleKey: "testTitle", descKey: "testDesc" },
  ]},
  leadRules: { steps: [
    { targetId: "lead-rules-header", titleKey: "headerTitle", descKey: "headerDesc" },
    { targetId: "lead-rules-kpis", titleKey: "kpisTitle", descKey: "kpisDesc" },
    { targetId: "lead-rules-list", titleKey: "listTitle", descKey: "listDesc" },
    { targetId: "lead-rules-new", titleKey: "newTitle", descKey: "newDesc" },
  ]},
  approvalRules: { steps: [
    { targetId: "approval-rules-header", titleKey: "headerTitle", descKey: "headerDesc" },
    { targetId: "approval-rules-list", titleKey: "listTitle", descKey: "listDesc" },
    { targetId: "approval-rules-new", titleKey: "newTitle", descKey: "newDesc" },
  ]},
  approvalDelegates: { steps: [
    { targetId: "approval-delegates-header", titleKey: "headerTitle", descKey: "headerDesc" },
    { targetId: "approval-delegates-list", titleKey: "listTitle", descKey: "listDesc" },
    { targetId: "approval-delegates-new", titleKey: "newTitle", descKey: "newDesc" },
  ]},
  roles: { steps: [
    { targetId: "roles-header", titleKey: "headerTitle", descKey: "headerDesc" },
    { targetId: "roles-list", titleKey: "listTitle", descKey: "listDesc" },
    { targetId: "roles-matrix", titleKey: "matrixTitle", descKey: "matrixDesc" },
    { targetId: "roles-save", titleKey: "saveTitle", descKey: "saveDesc" },
  ]},
  notificationsSettings: { steps: [
    { targetId: "notifications-header", titleKey: "headerTitle", descKey: "headerDesc" },
    { targetId: "notifications-groups", titleKey: "groupsTitle", descKey: "groupsDesc" },
    { targetId: "notifications-section", titleKey: "sectionTitle", descKey: "sectionDesc" },
  ]},
  escalationSettings: { steps: [
    { targetId: "escalation-header", titleKey: "headerTitle", descKey: "headerDesc" },
    { targetId: "escalation-list", titleKey: "listTitle", descKey: "listDesc" },
    { targetId: "escalation-new", titleKey: "newTitle", descKey: "newDesc" },
  ]},
  intakeForms: { steps: [
    { targetId: "intake-forms-header", titleKey: "headerTitle", descKey: "headerDesc" },
    { targetId: "intake-forms-list", titleKey: "listTitle", descKey: "listDesc" },
    { targetId: "intake-forms-new", titleKey: "newTitle", descKey: "newDesc" },
  ]},
  webToLeadSettings: { steps: [
    { targetId: "web-to-lead-header", titleKey: "headerTitle", descKey: "headerDesc" },
    { targetId: "web-to-lead-config", titleKey: "configTitle", descKey: "configDesc" },
    { targetId: "web-to-lead-endpoint", titleKey: "endpointTitle", descKey: "endpointDesc" },
    { targetId: "web-to-lead-embed", titleKey: "embedTitle", descKey: "embedDesc" },
    { targetId: "web-to-lead-preview", titleKey: "previewTitle", descKey: "previewDesc" },
  ]},
  emailTemplatesSettings: { steps: [
    { targetId: "email-templates-header", titleKey: "headerTitle", descKey: "headerDesc" },
    { targetId: "email-templates-stats", titleKey: "statsTitle", descKey: "statsDesc" },
    { targetId: "email-templates-list", titleKey: "listTitle", descKey: "listDesc" },
    { targetId: "email-templates-new", titleKey: "newTitle", descKey: "newDesc" },
  ]},
  messageSnippets: { steps: [
    { targetId: "snippets-header", titleKey: "headerTitle", descKey: "headerDesc" },
    { targetId: "snippets-list", titleKey: "listTitle", descKey: "listDesc" },
    { targetId: "snippets-new", titleKey: "newTitle", descKey: "newDesc" },
  ]},
  taskTemplatesSettings: { steps: [
    { targetId: "task-templates-header", titleKey: "headerTitle", descKey: "headerDesc" },
    { targetId: "task-templates-list", titleKey: "listTitle", descKey: "listDesc" },
    { targetId: "task-templates-new", titleKey: "newTitle", descKey: "newDesc" },
  ]},
  salesForecastSettings: { steps: [
    { targetId: "sales-forecast-header", titleKey: "headerTitle", descKey: "headerDesc" },
    { targetId: "sales-forecast-controls", titleKey: "controlsTitle", descKey: "controlsDesc" },
    { targetId: "sales-forecast-grid", titleKey: "gridTitle", descKey: "gridDesc" },
    { targetId: "sales-forecast-save", titleKey: "saveTitle", descKey: "saveDesc" },
  ]},
  territoriesSettings: { steps: [
    { targetId: "territories-header", titleKey: "headerTitle", descKey: "headerDesc" },
    { targetId: "territories-stats", titleKey: "statsTitle", descKey: "statsDesc" },
    { targetId: "territories-list", titleKey: "listTitle", descKey: "listDesc" },
    { targetId: "territories-new", titleKey: "newTitle", descKey: "newDesc" },
  ]},
  workflowTemplatesSettings: { steps: [
    { targetId: "workflow-templates-header", titleKey: "headerTitle", descKey: "headerDesc" },
    { targetId: "workflow-templates-list", titleKey: "listTitle", descKey: "listDesc" },
    { targetId: "workflow-templates-card", titleKey: "cardTitle", descKey: "cardDesc" },
  ]},
  whatsappSettings: { steps: [
    { targetId: "whatsapp-settings-header", titleKey: "headerTitle", descKey: "headerDesc" },
    { targetId: "whatsapp-settings-credentials", titleKey: "credentialsTitle", descKey: "credentialsDesc" },
    { targetId: "whatsapp-settings-webhook", titleKey: "webhookTitle", descKey: "webhookDesc" },
    { targetId: "whatsapp-settings-notifications", titleKey: "notificationsTitle", descKey: "notificationsDesc" },
    { targetId: "whatsapp-settings-templates", titleKey: "templatesTitle", descKey: "templatesDesc" },
  ]},
  leaderboardSettings: { steps: [
    { targetId: "leaderboard-config-header", titleKey: "headerTitle", descKey: "headerDesc" },
    { targetId: "leaderboard-config-weights", titleKey: "weightsTitle", descKey: "weightsDesc" },
    { targetId: "leaderboard-config-bands", titleKey: "bandsTitle", descKey: "bandsDesc" },
    { targetId: "leaderboard-config-save", titleKey: "saveTitle", descKey: "saveDesc" },
  ]},
  quotasSettings: { steps: [
    { targetId: "quotas-header", titleKey: "headerTitle", descKey: "headerDesc" },
    { targetId: "quotas-year", titleKey: "yearTitle", descKey: "yearDesc" },
    { targetId: "quotas-form", titleKey: "formTitle", descKey: "formDesc" },
    { targetId: "quotas-list", titleKey: "listTitle", descKey: "listDesc" },
  ]},
  aiAutomation: { steps: [
    { targetId: "ai-hero", titleKey: "heroTitle", descKey: "heroDesc" },
    { targetId: "ai-budget", titleKey: "budgetTitle", descKey: "budgetDesc" },
    { targetId: "ai-delivery", titleKey: "deliveryTitle", descKey: "deliveryDesc" },
    { targetId: "ai-toggles", titleKey: "togglesTitle", descKey: "togglesDesc" },
  ]},
  aiActions: { steps: [
    { targetId: "ai-actions-header", titleKey: "headerTitle", descKey: "headerDesc" },
    { targetId: "ai-actions-kpis", titleKey: "kpisTitle", descKey: "kpisDesc" },
    { targetId: "ai-actions-tabs", titleKey: "tabsTitle", descKey: "tabsDesc" },
    { targetId: "ai-actions-rail", titleKey: "railTitle", descKey: "railDesc" },
    { targetId: "ai-actions-detail", titleKey: "detailTitle", descKey: "detailDesc" },
  ]},
  socialMonitoring: { steps: [
    { targetId: "social-accounts", titleKey: "accountsTitle", descKey: "accountsDesc" },
    { targetId: "social-feed", titleKey: "feedTitle", descKey: "feedDesc" },
    { targetId: "social-ai", titleKey: "aiTitle", descKey: "aiDesc" },
  ]},
  workflows: { steps: [
    { targetId: "workflows-list", titleKey: "listTitle", descKey: "listDesc" },
    { targetId: "workflows-new", titleKey: "newTitle", descKey: "newDesc" },
  ]},
  pipelines: { steps: [
    { targetId: "pipelines-header", titleKey: "headerTitle", descKey: "headerDesc" },
  ]},
  users: { steps: [
    { targetId: "users-list", titleKey: "listTitle", descKey: "listDesc" },
    { targetId: "users-new", titleKey: "newTitle", descKey: "newDesc" },
  ]},
  slaPolicies: { steps: [
    { targetId: "sla-header", titleKey: "headerTitle", descKey: "headerDesc" },
  ]},
  skillRouting: { steps: [
    { targetId: "sr-header", titleKey: "headerTitle", descKey: "headerDesc" },
    { targetId: "sr-agents", titleKey: "agentsTitle", descKey: "agentsDesc" },
    { targetId: "sr-queues", titleKey: "queuesTitle", descKey: "queuesDesc" },
  ]},
  macros: { steps: [
    { targetId: "macros-header", titleKey: "headerTitle", descKey: "headerDesc" },
    { targetId: "macros-filters", titleKey: "filtersTitle", descKey: "filtersDesc" },
    { targetId: "macros-list", titleKey: "listTitle", descKey: "listDesc" },
    { targetId: "macros-new", titleKey: "newTitle", descKey: "newDesc" },
    { targetId: "macros-shortcuts", titleKey: "shortcutsTitle", descKey: "shortcutsDesc" },
  ]},
  channels: { steps: [
    { targetId: "channels-header", titleKey: "headerTitle", descKey: "headerDesc" },
  ]},
  integrations: { steps: [
    { targetId: "integrations-header", titleKey: "headerTitle", descKey: "headerDesc" },
  ]},
  customFields: { steps: [
    { targetId: "fields-header", titleKey: "headerTitle", descKey: "headerDesc" },
  ]},
  invoiceSettings: { steps: [
    { targetId: "inv-settings-header", titleKey: "headerTitle", descKey: "headerDesc" },
  ]},
  financeNotifications: { steps: [
    { targetId: "fin-notif-header", titleKey: "headerTitle", descKey: "headerDesc" },
  ]},
  voip: { steps: [
    { targetId: "voip-header", titleKey: "headerTitle", descKey: "headerDesc" },
  ]},
  webChatSettings: { steps: [
    { targetId: "webchat-header", titleKey: "headerTitle", descKey: "headerDesc" },
    { targetId: "webchat-embed", titleKey: "embedTitle", descKey: "embedDesc" },
    { targetId: "webchat-behavior", titleKey: "behaviorTitle", descKey: "behaviorDesc" },
    { targetId: "webchat-origins", titleKey: "originsTitle", descKey: "originsDesc" },
  ]},
  fieldPermissions: { steps: [
    { targetId: "perms-header", titleKey: "headerTitle", descKey: "headerDesc" },
  ]},
  organization: { steps: [
    { targetId: "org-header", titleKey: "headerTitle", descKey: "headerDesc" },
  ]},
  billing: { steps: [
    { targetId: "billing-header", titleKey: "headerTitle", descKey: "headerDesc" },
  ]},
  security: { steps: [
    { targetId: "security-header", titleKey: "headerTitle", descKey: "headerDesc" },
  ]},
  auditLog: { steps: [
    { targetId: "audit-header", titleKey: "headerTitle", descKey: "headerDesc" },
  ]},
  portalUsers: { steps: [
    { targetId: "portal-header", titleKey: "headerTitle", descKey: "headerDesc" },
  ]},
  customDomains: { steps: [
    { targetId: "domains-header", titleKey: "headerTitle", descKey: "headerDesc" },
  ]},
  dashboardSettings: { steps: [
    { targetId: "widget-header", titleKey: "headerTitle", descKey: "headerDesc" },
  ]},
}
