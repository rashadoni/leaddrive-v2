import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import ts from '/workspace/hrm-safe-logging/node_modules/typescript/lib/typescript.js'
const root='/workspace/hrm-safe-logging'
const roots=['src/lib/workforce','src/app/api/v1/workforce',...fs.readdirSync(path.join(root,'src/app/api/cron')).filter(x=>x.startsWith('workforce')).map(x=>'src/app/api/cron/'+x)]
const files=[];function walk(dir){for(const e of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())walk(p);else if(p.endsWith('.ts'))files.push(p)}};roots.forEach(walk)
const calls=[]
for(const name of files){const text=fs.readFileSync(path.join(root,name),'utf8');const source=ts.createSourceFile(name,text,ts.ScriptTarget.Latest,true);function visit(node){if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.expression.getText(source)==='console'&&['error','warn','log','info','debug'].includes(node.expression.name.text)){
 const args=node.arguments.map(a=>a.getText(source));calls.push({path:name,line:source.getLineAndCharacterOfPosition(node.getStart(source)).line+1,method:node.expression.name.text,classification:name.endsWith('/sensitive-operation-log.ts')?'EXISTING_SHARED_SINK':args.some(a=>a==='error')?'RAW_THROWN_VALUE':args.some(a=>a.includes('error.name'))?'ERROR_DERIVED_NAME':'REQUIRES_SOURCE_REVIEW',arguments:args,sourceSha256:crypto.createHash('sha256').update(text).digest('hex')})
}ts.forEachChild(node,visit)}visit(source)}
const report={baseHead:'dc91bd039cf25f9f30b9580471e0f409ebf6eb2e',scope:'POST_CHANGE_LOCAL_SOURCE_INVENTORY_NOT_RUNTIME_EVIDENCE',scannedRoots:roots,filesScanned:files.length,calls,limitations:['Syntactic console calls only; aliased loggers, third-party/driver logging, framework handlers, client/MTM/shared platform surfaces are not audited here.','Remaining source paths are next-slice preparation, not proof of runtime data leakage or global privacy acceptance.']}
fs.writeFileSync('/tmp/hrm-logging-remaining-console-inventory.json',JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify({files:files.length,totalCalls:calls.length,byClassification:calls.reduce((m,r)=>(m[r.classification]=(m[r.classification]||0)+1,m),{})}))
