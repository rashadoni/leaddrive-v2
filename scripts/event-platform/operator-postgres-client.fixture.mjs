// Disposable CI transport only. Not a database driver for the application.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
function guard() {
  assert.equal(process.env.LD_OPERATOR_DISPOSABLE,'1')
  assert.equal(process.env.PGDATABASE,'kafka_operator_test')
  assert.equal(process.env.PGUSER,'control_test_admin')
  assert.ok(['localhost','127.0.0.1'].includes(process.env.PGHOST))
}
export const quoteFixture = value => `'${String(value).replaceAll("'","''")}'`
function open(login,options={}) {
  guard()
  const child=spawn('psql',['-X','-qAt','-v','ON_ERROR_STOP=1','-v',options.sanitizedDiagnostics===true?'VERBOSITY=verbose':'VERBOSITY=sqlstate'],{
    env:{...process.env,PGUSER:login,PGPASSWORD:'operator-fixture-only',PGOPTIONS:'-c statement_timeout=10000 -c lock_timeout=2000'},
    stdio:['pipe','pipe','pipe'],
  })
  let pending, buffer='', errors='', closed=false
  const timer=setTimeout(()=>child.kill('SIGKILL'),20000)
  const done=new Promise(resolve=>{
    child.once('error',()=>{ pending?.reject(new Error('FIXTURE_PSQL_START_FAILED')); pending=undefined })
    child.once('close',code=>{
      clearTimeout(timer);closed=true
      const deniedObject=options.sanitizedDiagnostics===true ? errors.match(/permission denied for (?:table|schema|function|sequence|relation) ([a-z_][a-z0-9_]{0,62})/)?.[1] : undefined
      pending?.reject(new Error(`FIXTURE_PSQL_REJECTED:${errors.match(/ERROR:\s*([A-Z0-9]{5})/)?.[1] ?? code}${deniedObject?':object='+deniedObject:''}`));pending=undefined
      resolve()
    })
  })
  child.stderr.on('data',data=>{errors=(errors+data.toString()).slice(-2048)})
  child.stdout.on('data',data=>{
    buffer+=data.toString()
    if(buffer.length>2097152){child.kill('SIGKILL');return}
    for(let newline; (newline=buffer.indexOf('\n'))>=0;) {
      const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1)
      if(!pending)continue
      if(line===pending.marker){ const p=pending;pending=undefined;p.resolve(p.output.join('\n')) }
      else pending.output.push(line)
    }
  })
  return {
    async command(sql) {
      assert.ok(!pending && !closed,'fixture connection unavailable')
      return new Promise((resolve,reject)=>{
        const marker=`done-${randomUUID()}`;pending={resolve,reject,marker,output:[]}
        child.stdin.write(`${sql}\nSELECT ${quoteFixture(marker)};\n`)
      })
    },
    async close(){ if(!closed)child.stdin.end();await done },
  }
}
// Explicit connection lifetime for deterministic concurrent barrier proofs.
export const fixtureConnection = (login,options) => open(login,options)
export async function fixtureSql(login,sql,options) {
  const connection=open(login,options)
  try{return await connection.command(sql)}finally{await connection.close()}
}
export function fixtureDatabase(login,hooks={}) {
  return {$transaction:async(work,options)=>{
    assert.equal(options.isolationLevel,'RepeatableRead')
    const connection=open(login);let counter=0
    try {
      await connection.command('BEGIN ISOLATION LEVEL REPEATABLE READ;')
      const tx={
        async $executeRawUnsafe(sql){await connection.command(`${sql};`);return 0},
        async $queryRawUnsafe(sql,...values){
          const name=`reader_${++counter}`,body=sql.trim().replace(/;$/,'')
          const output=await connection.command(`PREPARE ${name} AS SELECT coalesce(jsonb_agg(to_jsonb(result)),'[]'::jsonb) FROM (${body}) result; EXECUTE ${name}${values.length ? `(${values.map(quoteFixture).join(',')})` : ''}; DEALLOCATE ${name};`)
          const result=JSON.parse(output)
          await hooks.afterQuery?.(sql,tx,result)
          return result
        },
      }
      const result=await work(tx)
      await hooks.beforeCommit?.(tx)
      await connection.command('COMMIT;')
      return result
    } catch(error){
      try{await connection.command('ROLLBACK;')}catch{}
      throw error
    } finally {await connection.close()}
  }}
}
