import test from 'node:test'
import assert from 'node:assert/strict'
import {fixtureRestoredDatabase} from './operator-postgres-client.fixture.mjs'
test('restore route refuses other databases or connection overrides before opening SQL',()=>{
 const fields={GITHUB_ACTIONS:'true',LD_OPERATOR_DISPOSABLE:'1',PGDATABASE:'kafka_operator_test',PGUSER:'control_test_admin',PGHOST:'127.0.0.1',PGPORT:'1',PGHOSTADDR:undefined,PGSERVICE:undefined,PGSERVICEFILE:undefined}
 const saved=Object.fromEntries(Object.keys(fields).map(k=>[k,process.env[k]]))
 try{
  for(const[k,v]of Object.entries(fields))if(v===undefined)delete process.env[k];else process.env[k]=v
  for(const name of ['postgres','production','kafka_operator_test','postgresql://127.0.0.1/other','kafka_operator_restore_'+('a'.repeat(31)),'kafka_operator_restore_'+('A'.repeat(32))])assert.throws(()=>fixtureRestoredDatabase(name))
  const valid='kafka_operator_restore_'+('a'.repeat(32))
  assert.equal(typeof fixtureRestoredDatabase(valid).$transaction,'function')
  for(const[key,value]of [['PGHOST','other.invalid'],['PGHOSTADDR','127.0.0.1'],['PGSERVICE','other'],['GITHUB_ACTIONS','false'],['PGDATABASE','production']]){
   const previous=process.env[key];process.env[key]=value;assert.throws(()=>fixtureRestoredDatabase(valid));if(previous===undefined)delete process.env[key];else process.env[key]=previous
  }
 }finally{for(const[k,v]of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v}
})
