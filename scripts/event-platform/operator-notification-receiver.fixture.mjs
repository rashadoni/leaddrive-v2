// Separate disposable CI process, NOT a provider/service implementation.
// A machine responder and controlled stimuli prove transport/read-back only;
// production rules/exporters/human paging/HA/credential provisioning stay open.
import {createServer} from 'node:http'
import {createHash} from 'node:crypto'
import {open,readFile} from 'node:fs/promises'
import {OPERATOR_ALERT_GATES} from './operator-alert-evidence.mjs'
if(process.env.GITHUB_ACTIONS!=='true'||process.env.LD_OPERATOR_DISPOSABLE!=='1'||!process.send)throw new Error('DISPOSABLE_NOTIFICATION_REQUIRED')
const timer=setTimeout(()=>process.exit(1),60000)
process.once('message',async config=>{
 let file,server
 try{
  if(!config.path.startsWith(process.env.RUNNER_TEMP+'/')||new Set(Object.values(config.tokens)).size!==3)throw new Error('denied')
  const entries=new Map()
  if(config.restore){
   for(const line of (await readFile(config.path,'utf8')).trim().split('\n')){if(!line)continue;const row=JSON.parse(line);entries.set(row.receipt.receiptId,row)}
   file=await open(config.path,'a',0o600)
  }else file=await open(config.path,'wx',0o600)
  async function persist(row){await file.write(JSON.stringify(row)+'\n');await file.sync();entries.set(row.receipt.receiptId,row)}
  server=createServer(async(req,res)=>{
   const send=(code,value)=>{res.writeHead(code,{'content-type':'application/json'});res.end(JSON.stringify(value))}
   try{
    const url=new URL(req.url,'http://127.0.0.1'),id=url.pathname.split('/')[2]
    const actor=Object.keys(config.tokens).find(k=>req.headers.authorization===`Bearer ${config.tokens[k]}`)
    if(req.method==='GET'&&url.pathname.startsWith('/receipts/')&&actor==='reader'){
     if(id==='probe-redirect'){res.writeHead(302,{location:'http://127.0.0.1:1/forbidden'});return res.end()}
     if(id==='probe-large'){res.writeHead(200,{'content-type':'application/json','content-length':65537});return res.end('x'.repeat(65537))}
     if(id==='probe-chunked'){res.writeHead(200,{'content-type':'application/json'});res.write('x'.repeat(32768));return res.end('x'.repeat(32769))}
     if(id==='probe-bad-json')return send(200,'not an object')
     if(id==='probe-bad-utf8'){res.writeHead(200,{'content-type':'application/json'});return res.end(Buffer.from([0xc0,0x80]))}
     const entry=entries.get(decodeURIComponent(id));return send(entry?200:404,entry?.receipt??{})
    }
    if(req.method!=='POST'||!['/alerts','/ack'].includes(url.pathname)||actor!==(url.pathname==='/alerts'?'sender':'responder'))return send(403,{})
    let bytes=0;const chunks=[]
    for await(const chunk of req){bytes+=chunk.length;if(bytes>8192)return send(413,{});chunks.push(chunk)}
    const body=JSON.parse(Buffer.concat(chunks)),receiptId=body.receiptId
    if(typeof receiptId!=='string'||!/^[A-Za-z0-9._:-]{1,200}$/.test(receiptId))return send(400,{})
    if(url.pathname==='/ack'){
     const entry=entries.get(receiptId);if(!entry)return send(404,{})
     if(!entry.receipt.acknowledged)await persist({...entry,receipt:{...entry.receipt,acknowledged:true,acknowledgedAt:new Date().toISOString()}})
     return send(200,{receiptId})
    }
    if(!OPERATOR_ALERT_GATES.includes(body.gate))return send(400,{})
    for(const key of ['environment','releaseSha','changeId','challengeId','destinationId','responderId'])if(body[key]!==config.scope[key])return send(403,{})
    if(new Date(body.triggeredAt).toISOString()!==body.triggeredAt||Date.parse(body.triggeredAt)>Date.now()||Date.now()-Date.parse(body.triggeredAt)>60000)return send(400,{})
    const hash=createHash('sha256').update(JSON.stringify(body)).digest('hex'),existing=entries.get(receiptId)
    if(existing)return send(existing.hash===hash?200:409,{receiptId})
    if(entries.size>=20)return send(429,{})
    await persist({hash,receipt:{...config.scope,receiptId,gate:body.gate,triggeredAt:body.triggeredAt,
     deliveredAt:new Date().toISOString(),status:'delivered',acknowledged:false}})
    return send(202,{receiptId})
   }catch{return send(400,{})}
  })
  server.listen(0,'127.0.0.1',()=>process.send({port:server.address().port,pid:process.pid}))
  process.on('message',async message=>{if(message==='stop')server.close(async()=>{await file.close();clearTimeout(timer);process.disconnect()})})
 }catch{process.exitCode=1;clearTimeout(timer);await file?.close();server?.close();process.disconnect()}
})
