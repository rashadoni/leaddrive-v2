const fs=require('fs'),path=require('path'),crypto=require('crypto'),ts=require('/workspace/hrm-privacy-audit/node_modules/typescript');
const root='/workspace/hrm-privacy-audit',base='/workspace/hrm-request-logging';
const parent=JSON.parse(fs.readFileSync('/tmp/hrm-request-independent-remote-tree.json')).tree.filter(x=>x.type==='blob');
const rows=JSON.parse(fs.readFileSync(root+'/src/__tests__/fixtures/workforce-privacy-routes.json'));
const prod=[...new Set(rows.map(x=>x.path)),'src/lib/with-workforce-rls-auth.ts','src/lib/workforce/sensitive-operation-log.ts','src/lib/workforce/play-integrity.ts'];
function normalize(file,source){const sf=ts.createSourceFile(file,source,99,true);const edits=[];
 function visit(n){if(ts.isImportDeclaration(n)&&n.moduleSpecifier.text==='@/lib/workforce/sensitive-operation-log'){edits.push([n.getStart(sf),n.end,'']);return;}
 if(ts.isExpressionStatement(n)&&ts.isCallExpression(n.expression)&&['console.error','logWorkforceSensitiveOperationFailure'].includes(n.expression.expression.getText(sf))){edits.push([n.getStart(sf),n.end,'']);return;}ts.forEachChild(n,visit);}visit(sf);
 let out=source;for(const [start,end,text] of edits.sort((a,b)=>b[0]-a[0]))out=out.slice(0,start)+text+out.slice(end);
 const tree=ts.createSourceFile(file,out,99,true),bindings=[];
 function catches(n){if(ts.isCatchClause(n)&&n.variableDeclaration){let count=0;const name=n.variableDeclaration.name.getText(tree);function uses(x){if(ts.isIdentifier(x)&&x.text===name&&!(ts.isPropertyAssignment(x.parent)&&x.parent.name===x))count++;ts.forEachChild(x,uses);}uses(n.block);if(!count)bindings.push([n.variableDeclaration.getStart(tree)-1,n.variableDeclaration.end+1]);}ts.forEachChild(n,catches)}catches(tree);
 for(const [start,end] of bindings.sort((a,b)=>b[0]-a[0]))out=out.slice(0,start)+out.slice(end);
 return ts.createPrinter({removeComments:false}).printFile(ts.createSourceFile(file,out,99,true));
}
const checks=[];
for(const file of prod){let a=fs.readFileSync(base+'/'+file,'utf8'),b=fs.readFileSync(root+'/'+file,'utf8');
 if(file.endsWith('play-integrity.ts')){b=b.replaceAll('BigInt(0)','0n').replaceAll('BigInt(1_000)','1_000n').replaceAll('BigInt(-1)','-1n');if(a!==b)throw Error('BigInt outside expected substitution');}
 else if(file.endsWith('sensitive-operation-log.ts')){const labels=[...rows.map(x=>x.operation),'auth-workforce-capability','auth-workforce-schedule','auth-workforce-pilot-fence','auth-workforce-retention','auth-workforce-employment','auth-workforce-exception-queue','auth-workforce-exception-decision'];for(const label of labels){const line='    | "'+label+'"\n';if(b.split(line).length!==2)throw Error('label count');b=b.replace(line,'');}if(a!==b)throw Error('helper runtime changed');}
 else if(normalize(file,a)!==normalize(file,b))throw Error('nonlogging AST delta '+file);
 checks.push(file);
}
const bindings=[],unchanged=[];for(const e of parent){const p=root+'/'+e.path;const data=fs.readFileSync(p);const blob=crypto.createHash('sha1').update('blob '+data.length+'\0').update(data).digest('hex');const mode=(fs.statSync(p).mode&0o111)?'100755':'100644';if(mode!==e.mode)throw Error('mode '+e.path);if(blob===e.sha)unchanged.push(e.path);else if(!prod.includes(e.path))throw Error('unowned modification '+e.path);else bindings.push({path:e.path,mode,bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex'),git_blob_sha:blob});}
const added=['src/__tests__/api-workforce-privacy-audit.test.ts','src/__tests__/workforce-auth-failure-logging.test.ts','src/__tests__/workforce-privacy-telemetry.test.ts','src/__tests__/workforce-privacy-source-audit.test.ts','src/__tests__/fixtures/workforce-privacy-routes.json','docs/workforce-privacy-audit-2026-10-06.md'];
for(const file of added){if(parent.some(x=>x.path===file))throw Error('notnew');const data=fs.readFileSync(root+'/'+file);bindings.push({path:file,mode:'100644',bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex'),git_blob_sha:crypto.createHash('sha1').update('blob '+data.length+'\0').update(data).digest('hex')});}
const receipt={parent:'ef5d90010d9b317a493dfe7ae574b1863f3c83fb',parent_blobs_verified:parent.length,unchanged:unchanged.length,production_delta:checks.length,route_calls:46,wrapper_calls:7,new_paths:added.length,normalized_domain_ast_equal_paths:checks.filter(x=>!x.endsWith('play-integrity.ts')&&!x.endsWith('sensitive-operation-log.ts')),helper_runtime_byte_identical:true,bigint_only_three_equivalent_constants:true,bindings};
fs.writeFileSync('/tmp/hrm-privacy-source-proof.json',JSON.stringify(receipt,null,2)+'\n');fs.writeFileSync('/tmp/hrm-privacy-source-elements.json',JSON.stringify(bindings.map(e=>({path:e.path,mode:e.mode,type:'blob',content:fs.readFileSync(root+'/'+e.path,'utf8')}))));
console.log(JSON.stringify({parent:parent.length,unchanged:unchanged.length,delta:bindings.length,production:prod.length,added:added.length}));
