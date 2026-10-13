import assert from 'node:assert/strict';
import test from 'node:test';
import {createSafeDiagnostics} from '../src/services/diagnosticsCore.ts';
test('support diagnostics allowlist excludes financial data, user identity, credentials and raw server messages',()=>{
  const privateText='DO-NOT-EXPORT-SECRET';
  const state={supabaseConfig:{url:privateText,anonKey:privateText,workspaceKey:privateText},accounts:[{name:privateText,balance:98}],contacts:[{phone:privateText}],transactions:[{receiptImages:[privateText]}],deals:[],debts:[],procedures:[],budgets:[],financialAudit:[{ownerId:privateText,reason:privateText}],localRevision:3,pendingCloudSync:true};
  const status={phase:'blocked',outbox:{ownerId:privateText,configId:privateText,pending:{revision:3,payload:state},attempts:2,nextAttemptAt:4,acknowledgedRevision:1,stop:{reason:'conflict',result:{message:privateText,cloudState:state}}}};
  const output=createSafeDiagnostics(state,status,'android',false),raw=JSON.stringify(output);
  assert.ok(!raw.includes(privateText));assert.ok(!raw.includes('balance'));assert.ok(!raw.includes('ownerId'));assert.equal(output.counts.auditEvents,1);
  assert.equal(output.sync.stopReason,'conflict');assert.equal(output.sync.pendingRevision,3);assert.equal(output.localRevision,3);
});
test('malformed diagnostics values cannot copy arbitrary error/phase fields into export',()=>{
  const secret='PRIVATE';const output=createSafeDiagnostics({localRevision:-1},{phase:secret,outbox:{attempts:secret,syncedAt:secret,stop:{reason:secret}}},secret,true);
  assert.ok(!JSON.stringify(output).includes(secret));assert.equal(output.platform,'unknown');assert.equal(output.sync.phase,'unknown');assert.equal(output.localRevision,undefined);
});
