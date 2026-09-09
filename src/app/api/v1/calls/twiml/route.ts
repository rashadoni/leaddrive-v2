import { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"

// TwiML endpoint — Twilio asks "what to do when call connects"
export async function POST(req: NextRequest) {
  return runWithRlsBypass(async () => {
    // Twilio sends form data with CallSid
    let toNumber = ""

    try {
      const formData = await req.formData()
      const callSid = formData.get("CallSid") as string
      const to = formData.get("To") as string

      if (to) {
        toNumber = to
      } else if (callSid) {
        // Fallback: look up from our CallLog
        const callLog = await prisma.callLog.findFirst({
          where: { callSid, provider: "twilio", callMode: { not: "ai" } },
        })
        if (callLog) toNumber = callLog.toNumber
      }
    } catch {
      // If form parsing fails, try query params
      const { searchParams } = new URL(req.url)
      toNumber = searchParams.get("To") || ""
    }

    if (!toNumber) {
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Sorry, we could not determine the number to dial.</Say>
</Response>`
      return new Response(twiml, { headers: { "Content-Type": "text/xml" } })
    }

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>
    <Number>${toNumber}</Number>
  </Dial>
</Response>`
    return new Response(twiml, { headers: { "Content-Type": "text/xml" } })
  })
}

export async function GET(req: NextRequest) {
  return POST(req)
}
