/** Inactive trusted receipt-service adapter. Read-only, no sender/ACK endpoint.
 * origin/token are service configuration, never operator request fields. TLS
 * and server authentication remain deployment prerequisites. Loopback HTTP is
 * allowed only for explicitly disposable hosted CI, not by default.
 */
export function createOperatorAlertReadBack({origin,bearerToken,disposableLoopback=false,timeoutMs=3000}) {
  const check=x=>{if(!x)throw new Error('OPERATOR_ALERT_READBACK_DENIED')}
  try {
    const base=new URL(origin)
    check(base.origin===origin && !base.username && !base.password && !base.search && !base.hash)
    check(base.protocol==='https:' || (disposableLoopback===true && process.env.GITHUB_ACTIONS==='true' && process.env.LD_OPERATOR_DISPOSABLE==='1' && base.protocol==='http:' && base.hostname==='127.0.0.1'))
    check(typeof bearerToken==='string' && /^[A-Za-z0-9_-]{32,256}$/.test(bearerToken))
    check(Number.isSafeInteger(timeoutMs) && timeoutMs>=50 && timeoutMs<=5000)
    const pinnedOrigin=base.origin,authorization=`Bearer ${bearerToken}`
    return async receiptId=>{
      try {
        check(typeof receiptId==='string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(receiptId))
        const response=await fetch(`${pinnedOrigin}/receipts/${encodeURIComponent(receiptId)}`,{
          method:'GET',headers:{authorization,accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(timeoutMs),
        })
        check(response.status===200 && response.headers.get('content-type')?.split(';')[0]==='application/json')
        const size=response.headers.get('content-length')
        if(size!==null)check(/^[0-9]+$/.test(size) && Number(size)<=65536)
        check(response.body)
        const reader=response.body.getReader(),chunks=[];let bytes=0
        try {
          for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.length;check(bytes<=65536);chunks.push(part.value)}
        }finally{await reader.cancel().catch(()=>{})}
        const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)))
        check(value && value.receiptId===receiptId)
        return value
      }catch{throw new Error('OPERATOR_ALERT_READBACK_DENIED')}
    }
  }catch{throw new Error('OPERATOR_ALERT_READBACK_DENIED')}
}
