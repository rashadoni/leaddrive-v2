import test from 'node:test'
import assert from 'node:assert/strict'
import {createOperatorAlertReadBack} from './operator-alert-http.mjs'
const good={origin:'https://receipt-service.invalid',bearerToken:'x'.repeat(40)}
for(const patch of [{origin:'http://receipt-service.invalid'},{origin:'https://user:secret@receipt-service.invalid'},{origin:'https://receipt-service.invalid/path'},{origin:'https://receipt-service.invalid?url=other'},{origin:'https://receipt-service.invalid#fragment'},{origin:'file:///tmp/receipt'},{bearerToken:'bad\r\nAuthorization: forged'},{timeoutMs:0},{timeoutMs:5001}])test('reject invalid service authority before network',()=>{
 assert.throws(()=>createOperatorAlertReadBack({...good,...patch}),{message:'OPERATOR_ALERT_READBACK_DENIED'})
})
test('loopback requires explicit disposable hosted environment',()=>{
 const saved={GITHUB_ACTIONS:process.env.GITHUB_ACTIONS,LD_OPERATOR_DISPOSABLE:process.env.LD_OPERATOR_DISPOSABLE}
 try{delete process.env.LD_OPERATOR_DISPOSABLE;assert.throws(()=>createOperatorAlertReadBack({...good,origin:'http://127.0.0.1:1',disposableLoopback:true}),{message:'OPERATOR_ALERT_READBACK_DENIED'})}
 finally{for(const[k,v]of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v}
})
test('invalid receipt selectors cannot change fixed endpoint or make a request',async()=>{
 const read=createOperatorAlertReadBack(good)
 for(const id of ['https://other.invalid','../other','a/b','a?token=secret','',null])await assert.rejects(read(id),{message:'OPERATOR_ALERT_READBACK_DENIED'})
})
