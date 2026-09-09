interface WelcomeTenantData {
  companyName: string
  loginUrl: string
  adminEmail: string
  tempPassword: string
  planName: string
}

export function getWelcomeTenantEmail(data: WelcomeTenantData): { subject: string; html: string } {
  return {
    subject: `Your LeadDrive CRM is ready — ${data.companyName}`,
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#6C63FF,#4F46E5);padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">LeadDrive CRM</h1>
              <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">Your CRM is ready to go</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <h2 style="margin:0 0 16px;color:#18181b;font-size:20px;">Welcome, ${data.companyName}!</h2>
              <p style="margin:0 0 24px;color:#52525b;font-size:15px;line-height:1.6;">
                Your LeadDrive CRM account has been provisioned and is ready to use.
                Below are your login credentials.
              </p>

              <!-- Credentials box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:24px;">
                <tr>
                  <td style="padding:20px;">
                    <p style="margin:0 0 8px;color:#71717a;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Login URL</p>
                    <p style="margin:0 0 16px;"><a href="${data.loginUrl}" style="color:#4F46E5;font-size:15px;font-weight:600;text-decoration:none;">${data.loginUrl}</a></p>

                    <p style="margin:0 0 8px;color:#71717a;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Email</p>
                    <p style="margin:0 0 16px;color:#18181b;font-size:15px;font-weight:500;">${data.adminEmail}</p>

                    <p style="margin:0 0 8px;color:#71717a;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Temporary Password</p>
                    <p style="margin:0;color:#18181b;font-size:15px;font-weight:500;font-family:monospace;background:#fff;padding:8px 12px;border:1px solid #e5e7eb;border-radius:4px;display:inline-block;">${data.tempPassword}</p>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 16px;color:#52525b;font-size:15px;line-height:1.6;">
                Plan: <strong>${data.planName}</strong>
              </p>

              <!-- CTA button -->
              <table cellpadding="0" cellspacing="0" style="margin:24px 0;">
                <tr>
                  <td style="background:#4F46E5;border-radius:8px;">
                    <a href="${data.loginUrl}" style="display:inline-block;padding:12px 32px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">Open Your CRM</a>
                  </td>
                </tr>
              </table>

              <p style="margin:0;color:#a1a1aa;font-size:13px;line-height:1.5;">
                Please change your password after your first login for security.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px;background:#fafafa;border-top:1px solid #f0f0f0;text-align:center;">
              <p style="margin:0;color:#a1a1aa;font-size:12px;">
                &copy; ${new Date().getFullYear()} LeadDrive CRM &mdash; Powered by LeadDrive Inc.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim(),
  }
}
