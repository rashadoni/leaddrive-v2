import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { attendanceRequestFailure } from "@/lib/mtm/attendance-request-http"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { readAttendanceMonthTable } from "@/lib/mtm/attendance-month-store"
import { AttendanceMonthExportSchema } from "@/lib/mtm/attendance-month-contract"
import { buildAttendancePdf, buildAttendanceXlsx } from "@/lib/mtm/attendance-export"
import { contentDispositionAttachment } from "@/lib/export/tabular"
type MonthExportContext={params:Promise<{id:string}>}
export const GET=withMtmAttendanceAuth<MonthExportContext>("read",async(req,auth,ctx)=>{try{if(auth.principalType!=="session")throw new AttendanceRequestError("MTM_ATTENDANCE_MONTH_FORBIDDEN",403);const parsed=AttendanceMonthExportSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));if(!parsed.success)throw new AttendanceRequestError("MTM_ATTENDANCE_MONTH_INVALID",400);const {locale,format}=parsed.data;
 // The closed month's frozen N-1t: the same cells as on screen, never rebuilt from today's data.
 const {month,form,table}=await readAttendanceMonthTable({organizationId:auth.orgId,userId:auth.userId,principalType:auth.principalType??"api_key"},(await ctx.params).id,locale)
 const bytes=format==="pdf"?buildAttendancePdf(table):Buffer.from(await buildAttendanceXlsx(table).xlsx.writeBuffer())
 return new Response(new Uint8Array(bytes),{headers:{"Content-Type":format==="pdf"?"application/pdf":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","Content-Disposition":contentDispositionAttachment(`${form==="N1T"?"N-1t":"attendance-closed"}-${month}.${format}`),"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}})
 }catch(error){return attendanceRequestFailure(error)}})
