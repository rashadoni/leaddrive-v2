interface DeletionEmailData {
  companyName: string
  deletionDate: string
  adminUrl: string
}

export function getDeletionScheduledEmail(data: DeletionEmailData): { subject: string; html: string } {
  return {
    subject: `[Action Required] ${data.companyName} — Account scheduled for deletion`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;">
        <tr><td style="background:#dc2626;padding:24px 40px;text-align:center;">
          <h1 style="margin:0;color:#fff;font-size:20px;">Account Deletion Scheduled</h1>
        </td></tr>
        <tr><td style="padding:32px 40px;">
          <p style="margin:0 0 16px;color:#18181b;font-size:15px;">
            The LeadDrive CRM account for <strong>${data.companyName}</strong> has been scheduled for permanent deletion.
          </p>
          <p style="margin:0 0 16px;color:#18181b;font-size:15px;">
            <strong>Deletion date:</strong> ${data.deletionDate}
          </p>
          <p style="margin:0 0 24px;color:#52525b;font-size:14px;">
            All data (contacts, deals, invoices, tickets, etc.) will be permanently removed on this date.
            You can cancel the deletion at any time before this date by contacting your administrator.
          </p>
          <p style="margin:0;color:#a1a1aa;font-size:12px;">LeadDrive CRM — Powered by LeadDrive Inc.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim(),
  }
}

export function getDeletionCompletedEmail(data: { companyName: string }): { subject: string; html: string } {
  return {
    subject: `${data.companyName} — Account has been deleted`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;">
        <tr><td style="background:#18181b;padding:24px 40px;text-align:center;">
          <h1 style="margin:0;color:#fff;font-size:20px;">Account Deleted</h1>
        </td></tr>
        <tr><td style="padding:32px 40px;">
          <p style="margin:0 0 16px;color:#18181b;font-size:15px;">
            The LeadDrive CRM account for <strong>${data.companyName}</strong> has been permanently deleted.
          </p>
          <p style="margin:0 0 16px;color:#52525b;font-size:14px;">
            All data has been removed. A JSON export was created before deletion for your records.
          </p>
          <p style="margin:0;color:#a1a1aa;font-size:12px;">LeadDrive CRM — Powered by LeadDrive Inc.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim(),
  }
}

export function getDeletionCancelledEmail(data: { companyName: string }): { subject: string; html: string } {
  return {
    subject: `${data.companyName} — Account deletion cancelled`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;">
        <tr><td style="background:#16a34a;padding:24px 40px;text-align:center;">
          <h1 style="margin:0;color:#fff;font-size:20px;">Deletion Cancelled</h1>
        </td></tr>
        <tr><td style="padding:32px 40px;">
          <p style="margin:0 0 16px;color:#18181b;font-size:15px;">
            The scheduled deletion for <strong>${data.companyName}</strong> has been cancelled.
          </p>
          <p style="margin:0 0 16px;color:#52525b;font-size:14px;">
            Your account has been reactivated and all data remains intact. You can continue using LeadDrive CRM as normal.
          </p>
          <p style="margin:0;color:#a1a1aa;font-size:12px;">LeadDrive CRM — Powered by LeadDrive Inc.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim(),
  }
}
