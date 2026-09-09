export interface LibraryTemplate {
  id: string
  name: string
  category: string
  description: string
  designJson: any
}

// Helper to generate valid Unlayer design JSON
function makeDesign(rows: any[], bodyValues?: any): any {
  return {
    counters: { u_row: rows.length, u_column: rows.length, u_content_text: 1 },
    body: {
      id: "design-body",
      rows,
      values: {
        backgroundColor: "#f5f5f5",
        contentWidth: "600px",
        contentAlign: "center",
        fontFamily: { label: "Arial", value: "arial,helvetica,sans-serif" },
        preheaderText: "",
        linkStyle: { body: true, linkColor: "#0071e3", linkHoverColor: "#0071e3", linkUnderline: true, linkHoverUnderline: true },
        _meta: { htmlID: "u_body", htmlClassNames: "u_body" },
        ...bodyValues,
      },
    },
    schemaVersion: 12,
  }
}

function textContent(id: string, html: string, styles?: any): any {
  return {
    id,
    type: "text",
    values: {
      containerPadding: "15px 20px",
      anchor: "",
      fontSize: "14px",
      color: "#333333",
      textAlign: "left",
      lineHeight: "160%",
      linkStyle: { inherit: true, linkColor: "#0071e3", linkHoverColor: "#0071e3", linkUnderline: true, linkHoverUnderline: true },
      hideDesktop: false,
      displayCondition: null,
      _meta: { htmlID: `u_content_${id}`, htmlClassNames: `u_content_${id}` },
      selectable: true,
      draggable: true,
      duplicatable: true,
      deletable: true,
      hideable: true,
      text: html,
      ...styles,
    },
  }
}

function buttonContent(id: string, text: string, bgColor: string, href?: string): any {
  return {
    id,
    type: "button",
    values: {
      containerPadding: "15px 20px",
      anchor: "",
      href: { name: "web", values: { href: href || "", target: "_blank" }, attrs: { href: "{{href}}", target: "{{target}}" } },
      buttonColors: { color: "#FFFFFF", backgroundColor: bgColor, hoverColor: "#FFFFFF", hoverBackgroundColor: bgColor },
      size: { autoWidth: false, width: "50%" },
      textAlign: "center",
      lineHeight: "120%",
      padding: "12px 24px",
      borderRadius: "6px",
      hideDesktop: false,
      displayCondition: null,
      _meta: { htmlID: `u_content_${id}`, htmlClassNames: `u_content_${id}` },
      selectable: true,
      draggable: true,
      duplicatable: true,
      deletable: true,
      hideable: true,
      text: `<span style="font-size: 14px; font-weight: 700;">${text}</span>`,
      calculatedWidth: 300,
      calculatedHeight: 42,
    },
  }
}

function dividerContent(id: string): any {
  return {
    id,
    type: "divider",
    values: {
      containerPadding: "10px 20px",
      border: { borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: "#e0e0e0" },
      width: "100%",
      textAlign: "center",
      hideDesktop: false,
      displayCondition: null,
      _meta: { htmlID: `u_content_${id}`, htmlClassNames: `u_content_${id}` },
      selectable: true,
      draggable: true,
      duplicatable: true,
      deletable: true,
      hideable: true,
    },
  }
}

function makeRow(id: string, contents: any[], rowBg?: string): any {
  return {
    id,
    cells: [1],
    columns: [{
      id: `${id}_col`,
      contents,
      values: {
        _meta: { htmlID: `u_column_${id}`, htmlClassNames: `u_column_${id}` },
        border: {},
        padding: "0px",
        backgroundColor: "",
      },
    }],
    values: {
      displayCondition: null,
      columns: false,
      backgroundColor: rowBg || "",
      columnsBackgroundColor: "#ffffff",
      backgroundImage: { url: "", fullWidth: true, repeat: "no-repeat", size: "custom", position: "center" },
      padding: "0px",
      anchor: "",
      hideDesktop: false,
      _meta: { htmlID: `u_row_${id}`, htmlClassNames: `u_row_${id}` },
      selectable: true,
      draggable: true,
      duplicatable: true,
      deletable: true,
      hideable: true,
    },
  }
}

// Pre-built Unlayer design templates with valid schemaVersion 12 format
export const EMAIL_TEMPLATE_LIBRARY: LibraryTemplate[] = [
  {
    id: "welcome",
    name: "Welcome Email",
    category: "welcome",
    description: "Onboarding welcome email with CTA button",
    designJson: makeDesign([
      makeRow("r1", [
        textContent("t1", '<h1 style="text-align: center; color: #1a1a1a;">Welcome, {{client_name}}!</h1>', { fontSize: "24px", textAlign: "center" }),
      ]),
      makeRow("r2", [
        textContent("t2", '<p style="text-align: center; color: #666;">We\'re excited to have <strong>{{company}}</strong> on board. Let\'s get you started with everything you need to succeed.</p>', { textAlign: "center" }),
      ]),
      makeRow("r3", [
        buttonContent("b1", "Get Started", "#3b82f6"),
      ]),
      makeRow("r4", [
        textContent("t3", '<p style="text-align: center; color: #999; font-size: 12px;">If you have any questions, reply to this email or contact our support team.</p>', { fontSize: "12px", textAlign: "center", color: "#999999" }),
      ]),
    ]),
  },
  {
    id: "newsletter",
    name: "Monthly Newsletter",
    category: "marketing",
    description: "Newsletter layout with header and content sections",
    designJson: makeDesign([
      makeRow("r1", [
        textContent("t1", '<h1 style="text-align: center; color: #1e40af;">{{company}} Newsletter</h1><p style="text-align: center; color: #64748b;">{{month}} {{year}}</p>', { textAlign: "center" }),
      ], "#1e40af10"),
      makeRow("r2", [dividerContent("d1")]),
      makeRow("r3", [
        textContent("t2", '<h2 style="color: #1a1a1a;">What\'s New</h2><p>Share your latest updates, product improvements, and company news with your audience. Keep your readers engaged with valuable content.</p>'),
      ]),
      makeRow("r4", [dividerContent("d2")]),
      makeRow("r5", [
        textContent("t3", '<h2 style="color: #1a1a1a;">Tips & Resources</h2><p>Provide helpful resources, best practices, and actionable advice that your readers can benefit from this month.</p>'),
      ]),
      makeRow("r6", [
        buttonContent("b1", "Read More on Our Blog", "#1e40af"),
      ]),
    ]),
  },
  {
    id: "follow-up",
    name: "Sales Follow-up",
    category: "follow_up",
    description: "Clean follow-up email for sales outreach",
    designJson: makeDesign([
      makeRow("r1", [
        textContent("t1", '<p>Hi {{client_name}},</p><p>I wanted to follow up on our recent conversation about <strong>{{service}}</strong>. I\'d love to discuss how we can help <strong>{{company}}</strong> achieve its goals.</p><p>Would you be available for a quick call this week? I\'m happy to work around your schedule.</p><p>Looking forward to hearing from you.</p><p>Best regards</p>'),
      ]),
    ]),
  },
  {
    id: "proposal",
    name: "Proposal / Offer",
    category: "proposal",
    description: "Professional proposal email with pricing section",
    designJson: makeDesign([
      makeRow("r1", [
        textContent("t1", '<h1 style="color: #1e40af;">Proposal for {{company}}</h1><p style="color: #64748b;">Prepared on {{date}}</p>'),
      ], "#f8fafc"),
      makeRow("r2", [
        textContent("t2", '<p>Dear {{client_name}},</p><p>Thank you for considering our <strong>{{service}}</strong> solution. Below you\'ll find our proposal tailored to your specific needs and requirements.</p><h3>Scope of Work</h3><p>Describe the deliverables, timeline, and pricing here. Include all relevant details that the client needs to make a decision.</p>'),
      ]),
      makeRow("r3", [dividerContent("d1")]),
      makeRow("r4", [
        buttonContent("b1", "Accept Proposal", "#16a34a"),
      ]),
      makeRow("r5", [
        textContent("t3", '<p style="color: #999; font-size: 12px; text-align: center;">This proposal is valid for 30 days from {{date}}.</p>', { fontSize: "12px", textAlign: "center", color: "#999999" }),
      ]),
    ]),
  },
  {
    id: "ticket-resolved",
    name: "Ticket Resolved",
    category: "notification",
    description: "Support ticket resolution notification",
    designJson: makeDesign([
      makeRow("r1", [
        textContent("t1", '<div style="text-align: center; padding: 10px;"><h1 style="color: #16a34a;">&#10003; Ticket Resolved</h1><p style="color: #64748b;">Your support request has been addressed</p></div>', { textAlign: "center" }),
      ]),
      makeRow("r2", [
        textContent("t2", '<p>Hi {{client_name}},</p><p>We\'re happy to let you know that your support ticket has been resolved. If you have any further questions or if the issue persists, don\'t hesitate to reach out.</p>'),
      ]),
      makeRow("r3", [
        buttonContent("b1", "Rate Your Experience", "#3b82f6"),
      ]),
    ]),
  },
  {
    id: "meeting-confirmation",
    name: "Meeting Confirmation",
    category: "notification",
    description: "Meeting date/time confirmation email",
    designJson: makeDesign([
      makeRow("r1", [
        textContent("t1", '<h1 style="text-align: center; color: #1a1a1a;">Meeting Confirmed</h1><p style="text-align: center; color: #3b82f6; font-size: 18px; font-weight: bold;">{{date}}</p>', { textAlign: "center" }),
      ]),
      makeRow("r2", [dividerContent("d1")]),
      makeRow("r3", [
        textContent("t2", '<p>Hi {{client_name}},</p><p>This is to confirm our upcoming meeting. We look forward to discussing <strong>{{service}}</strong> with the <strong>{{company}}</strong> team.</p><p>Please feel free to reach out if you need to reschedule.</p>'),
      ]),
      makeRow("r4", [
        buttonContent("b1", "Add to Calendar", "#3b82f6"),
      ]),
    ]),
  },
]
