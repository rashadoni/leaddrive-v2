/**
 * Seed script: Create/update event invitation email template
 * Run: npx tsx scripts/seed-event-template.ts
 */
import type { PrismaClient } from "@prisma/client"
import { makeScriptPrisma } from "./_rls.mjs"

let prisma!: PrismaClient

const ORG_ID = "cmmxg74k10000td3rr37dl6am"

const htmlBody = `<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{event_name}}</title>
</head>
<body style="margin:0;padding:0;background-color:#f0f2f5;font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0f2f5;padding:30px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.1);">

          <!-- HEADER with gradient background -->
          <tr>
            <td style="background-color:#4F46E5;background-image:linear-gradient(135deg,#4F46E5 0%,#7C3AED 50%,#9333EA 100%);padding:0;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:45px 40px 15px;text-align:center;">
                    <div style="font-size:13px;color:rgba(255,255,255,0.85);letter-spacing:3px;text-transform:uppercase;font-weight:600;">You're Invited To</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 40px 10px;text-align:center;">
                    <h1 style="margin:0;color:#ffffff;font-size:30px;font-weight:800;line-height:1.2;">{{event_name}}</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 40px 40px;text-align:center;">
                    <div style="display:inline-block;background:rgba(255,255,255,0.2);border-radius:20px;padding:6px 18px;font-size:13px;color:#ffffff;font-weight:600;">
                      {{event_date}}
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- GREETING -->
          <tr>
            <td style="padding:30px 40px 10px;">
              <p style="margin:0;font-size:16px;color:#1F2937;line-height:1.5;">
                Hello <strong>{{client_name}}</strong>,
              </p>
              <p style="margin:10px 0 0;font-size:15px;color:#4B5563;line-height:1.6;">
                We are pleased to invite you to our upcoming event. We would be honored to have you join us!
              </p>
            </td>
          </tr>

          <!-- EVENT DETAILS CARD -->
          <tr>
            <td style="padding:20px 40px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#F8FAFC;border-radius:12px;border:1px solid #E2E8F0;">
                <tr>
                  <td style="padding:24px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <!-- Date -->
                      <tr>
                        <td style="padding:8px 0;">
                          <table cellpadding="0" cellspacing="0">
                            <tr>
                              <td style="width:44px;vertical-align:middle;">
                                <div style="width:40px;height:40px;background-color:#EEF2FF;border-radius:10px;text-align:center;line-height:40px;font-size:20px;">&#128197;</div>
                              </td>
                              <td style="padding-left:14px;vertical-align:middle;">
                                <div style="font-size:11px;color:#9CA3AF;text-transform:uppercase;letter-spacing:1px;font-weight:700;">When</div>
                                <div style="font-size:15px;color:#1F2937;font-weight:600;margin-top:2px;">{{event_date}}</div>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      <!-- Location -->
                      <tr>
                        <td style="padding:8px 0;border-top:1px solid #E2E8F0;">
                          <table cellpadding="0" cellspacing="0">
                            <tr>
                              <td style="width:44px;vertical-align:middle;">
                                <div style="width:40px;height:40px;background-color:#FEF2F2;border-radius:10px;text-align:center;line-height:40px;font-size:20px;">&#128205;</div>
                              </td>
                              <td style="padding-left:14px;vertical-align:middle;">
                                <div style="font-size:11px;color:#9CA3AF;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Where</div>
                                <div style="font-size:15px;color:#1F2937;font-weight:600;margin-top:2px;">{{event_location}}</div>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- DESCRIPTION -->
          <tr>
            <td style="padding:0 40px 20px;">
              <p style="margin:0;font-size:14px;color:#6B7280;line-height:1.7;">{{event_description}}</p>
            </td>
          </tr>

          <!-- CTA BUTTON (VML for Outlook compatibility) -->
          <tr>
            <td style="padding:10px 40px 35px;text-align:center;">
              <!--[if mso]>
              <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="{{confirm_url}}" style="height:50px;v-text-anchor:middle;width:280px;" arcsize="20%" stroke="f" fillcolor="#4F46E5">
                <w:anchorlock/>
                <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">&#10003; Confirm My Attendance</center>
              </v:roundrect>
              <![endif]-->
              <!--[if !mso]><!-->
              <a href="{{confirm_url}}" style="display:inline-block;background-color:#4F46E5;color:#ffffff;text-decoration:none;padding:15px 45px;border-radius:10px;font-size:16px;font-weight:700;letter-spacing:0.3px;box-shadow:0 4px 14px rgba(79,70,229,0.4);">
                &#10003; Confirm My Attendance
              </a>
              <!--<![endif]-->
            </td>
          </tr>

          <!-- DIVIDER -->
          <tr>
            <td style="padding:0 40px;">
              <div style="height:1px;background-color:#E5E7EB;"></div>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="padding:25px 40px 30px;text-align:center;">
              <p style="margin:0;font-size:13px;color:#6B7280;">
                Sent by <strong style="color:#4F46E5;">{{company_name}}</strong>
              </p>
              <p style="margin:8px 0 0;font-size:11px;color:#9CA3AF;">
                You received this invitation because you were added as a participant.
              </p>
              <p style="margin:12px 0 0;font-size:11px;color:#9CA3AF;">
                <a href="{{confirm_url}}" style="color:#4F46E5;text-decoration:underline;">Click here</a> if the button above doesn't work.
              </p>
            </td>
          </tr>

        </table>

        <!-- BOTTOM BRANDING -->
        <table width="600" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding:20px 0;text-align:center;">
              <p style="margin:0;font-size:11px;color:#9CA3AF;">Powered by LeadDrive CRM</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

async function main() {
  prisma = await makeScriptPrisma()
  console.log("Creating/updating event invitation email template...")

  const existing = await prisma.emailTemplate.findFirst({
    where: { organizationId: ORG_ID, name: "Event Invitation" },
  })

  const data = {
    htmlBody,
    subject: "You're Invited: {{event_name}}",
    textBody: "Hello {{client_name}},\\n\\nYou're invited to {{event_name}}!\\n\\nDate: {{event_date}}\\nLocation: {{event_location}}\\n\\n{{event_description}}\\n\\nConfirm: {{confirm_url}}",
    variables: ["event_name", "event_date", "event_location", "event_description", "confirm_url", "client_name", "company_name"],
    category: "event",
    language: "en",
    isActive: true,
  }

  if (existing) {
    await prisma.emailTemplate.update({ where: { id: existing.id }, data })
    console.log("Updated template:", existing.id)
  } else {
    const t = await prisma.emailTemplate.create({
      data: { ...data, organizationId: ORG_ID, name: "Event Invitation" },
    })
    console.log("Created template:", t.id)
  }

  console.log("Done!")
}

main().catch(console.error).finally(() => prisma.$disconnect())
