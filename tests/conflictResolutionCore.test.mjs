import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareConflictResolution } from '../src/services/conflictResolutionCore.ts';
import { appendFinancialAudit, validateFinancialAudit } from '../src/services/financialAudit.ts';
import * as engine from '../src/services/financialEngine.ts';
import { syncConfigIdentity } from '../src/services/syncOutboxValidation.ts';

const OWNER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';
const DATE='2026-10-12T00:00:00.000Z',OLD='2026-10-13T00:01:00.123456+00:00',FRESH='2026-10-13T00:02:00.654321+00:00';
const secret='synthetic-key-do-not-copy-to-evidence';
const CONFIG={url:'https://auth.example.invalid',anonKey:secret,workspaceKey:'mali-vault-'+OWNER,autoSync:true,lastSyncedAt:OLD};
const metadata=id=>({ownerId:OWNER,action:'financial_update',reason:'Approved synthetic operation',operationId:id});
function base(){return {accounts:[{id:'cash',name:'Cash',bankName:'Cash',category:'cash_lyd',currency:'LYD',balance:100,isCash:true,color:'#000',updatedAt:DATE}],contacts:[],transactions:[],deals:[],debts:[],procedures:[],budgets:[],marketRates:{cashUsdToLyd:6.2,chequeUsdToLyd:6.3,defaultChequeDiscountPercent:0,updatedAt:DATE},supabaseConfig:{...CONFIG},lastModifiedAt:DATE,localRevision:0};}
const json=value=>JSON.parse(JSON.stringify(value));
function spend(s,id,amount){return json(appendFinancialAudit(s,engine.recordExpenseOrIncomeMutation(s,{id,idempotencyKey:id,title:'Expense',type:'expense',amount,currency:'LYD',category:'test',accountId:'cash',paymentMethod:'cash',date:DATE}),metadata(id)));}
function fixture(){
  const initial=base(),attempted={...spend(initial,'local-1',10),localRevision:1,pendingCloudSync:true};
  const local={...spend(attempted,'local-2',5),localRevision:2,pendingCloudSync:true};
  const cloud={...spend(initial,'cloud-1',20),localRevision:0};
  const configId=syncConfigIdentity(CONFIG);
  const outbox={version:1,ownerId:OWNER,configId,pending:{revision:2,payload:structuredClone(local)},attempts:1,nextAttemptAt:1,syncedAt:OLD,acknowledgedRevision:0,
    stop:{reason:'conflict',result:{ok:false,success:false,conflictDetected:true,message:'conflict',updatedAt:FRESH,snapshotUpdatedAt:FRESH,cloudState:structuredClone(cloud)},attempted:{revision:1,payload:structuredClone(attempted)}}};
  return json({choice:'keep-local',reason:'Keep the complete changes made on this device',review:{ownerId:OWNER,sessionGeneration:3,configId,localRevision:2,cloudTimestamp:FRESH},
    current:{ownerId:OWNER,sessionGeneration:3,configId,localRevision:2},local,blockedOutbox:outbox,
    freshCloud:{ownerId:OWNER,configId,identityVerified:true,snapshotUpdatedAt:FRESH,state:cloud}});
}
function prepared(input){const result=prepareConflictResolution(input);assert.equal(result.status,'prepared',JSON.stringify(result));return result;}

test('keep-local rebases the complete latest state onto the immutable accepted journal',()=>{
  const input=fixture(),before=structuredClone(input),result=prepared(input);
  assert.deepEqual(input,before);
  assert.equal(result.revision,3);assert.equal(result.candidate.localRevision,3);
  assert.deepEqual(result.candidate.accounts,input.local.accounts);
  assert.deepEqual(result.candidate.transactions,input.local.transactions);
  assert.deepEqual(result.candidate.financialAudit.slice(0,input.freshCloud.state.financialAudit.length),input.freshCloud.state.financialAudit);
  assert.equal(result.candidate.financialAudit.at(-1).action,'conflict_resolution_keep_local');
  assert.equal(result.candidate.financialAudit.at(-1).reason,input.reason);
  assert.equal(result.candidate.financialAudit.length,input.freshCloud.state.financialAudit.length+1);
  assert.equal(result.candidate.financialAudit.some(event=>event.operationId==='local-2'),false,'divergent events are archived, not relabeled accepted');
  validateFinancialAudit(result.candidate.financialAudit,result.candidate,OWNER);
  assert.equal(result.blockedRecord.stop.reason,'conflict');assert.equal(result.readyRecord.stop,undefined);
  assert.equal(result.blockedRecord.pending.revision,3);assert.equal(result.readyRecord.pending.revision,3);
  assert.equal(result.readyRecord.pending.payload.supabaseConfig.lastSyncedAt,FRESH);
  assert.equal(result.candidate.pendingCloudSync,true);assert.equal(result.readyRecord.syncedAt,FRESH);
  assert.equal(result.readyRecord.acknowledgedRevision,0,'preparation cannot claim cloud acceptance');
});

test('adopt-cloud takes exact cloud records, rates, and accepted history without uploading',()=>{
  const input=fixture();input.choice='adopt-cloud';
  input.local.marketRates={...input.local.marketRates,localOnlyQuote:999};
  // Keep this legacy input consistent rather than fabricating journal images.
  delete input.local.financialAudit;delete input.blockedOutbox.pending.payload.financialAudit;
  input.freshCloud.state.marketRates={...input.freshCloud.state.marketRates,cloudOnlyQuote:{rate:7,label:'extra preserved'}};
  delete input.freshCloud.state.financialAudit;
  const result=prepared(input);
  for(const collection of ['accounts','contacts','transactions','deals','debts','procedures','budgets','marketRates'])assert.deepEqual(result.candidate[collection],input.freshCloud.state[collection]);
  assert.equal(result.candidate.marketRates.localOnlyQuote,undefined);
  assert.deepEqual(result.candidate.marketRates.cloudOnlyQuote,input.freshCloud.state.marketRates.cloudOnlyQuote);
  assert.equal(result.candidate.financialAudit,undefined);
  assert.deepEqual(result.candidate.supabaseConfig,{...CONFIG,lastSyncedAt:FRESH});
  assert.equal(result.candidate.pendingCloudSync,false);assert.equal(result.readyRecord.pending,null);
  assert.equal(result.readyRecord.acknowledgedRevision,3);assert.equal(result.blockedRecord.stop.reason,'conflict');
  const audited=fixture();audited.choice='adopt-cloud';const exact=prepared(audited);
  assert.deepEqual(exact.candidate.financialAudit,audited.freshCloud.state.financialAudit);
});

test('recovery evidence preserves attempted, pending, latest, original cloud, fresh cloud, and chosen complete versions',()=>{
  const input=fixture();input.freshCloud.state=spend(input.freshCloud.state,'cloud-2',3);
  const result=prepared(input),evidence=result.evidence;
  assert.deepEqual(evidence.attempted.state.transactions,input.blockedOutbox.stop.attempted.payload.transactions);
  assert.deepEqual(evidence.pending.state.transactions,input.blockedOutbox.pending.payload.transactions);
  assert.deepEqual(evidence.latestLocal.transactions,input.local.transactions);
  assert.deepEqual(evidence.originalCloud.transactions,input.blockedOutbox.stop.result.cloudState.transactions);
  assert.deepEqual(evidence.freshCloud.transactions,input.freshCloud.state.transactions);
  assert.deepEqual(evidence.chosen.financialAudit,result.candidate.financialAudit);
  assert.equal(evidence.attempted.revision,1);assert.equal(evidence.pending.revision,2);
  assert.equal(evidence.originalCloudTimestamp,FRESH);assert.equal(evidence.reviewedTimestamp,FRESH);assert.equal(evidence.freshTimestamp,FRESH);
  const encoded=JSON.stringify(evidence);assert.equal(encoded.includes(secret),false);
  assert.equal(encoded.includes('anonKey'),false);assert.equal(encoded.includes('supabaseConfig'),false);assert.equal(encoded.includes('configId'),false);
  assert.deepEqual(evidence.connection,{url:CONFIG.url,workspaceKey:CONFIG.workspaceKey});
});

test('outputs are detached and deeply immutable even when callers mutate inputs later',()=>{
  const input=fixture(),result=prepared(input),original=JSON.stringify(result);
  input.local.transactions[0].title='mutated caller';input.freshCloud.state.financialAudit[0].reason='mutated caller';
  input.blockedOutbox.stop.result.cloudState.accounts[0].balance=1;
  assert.equal(JSON.stringify(result),original);
  for(const value of [result,result.candidate,result.candidate.transactions,result.candidate.transactions[0],result.readyRecord.pending.payload,result.evidence.originalCloud])assert.equal(Object.isFrozen(value),true);
  assert.throws(()=>{result.candidate.accounts[0].balance=999;},TypeError);
  assert.throws(()=>{result.evidence.pending.state.transactions.pop();},TypeError);
});

test('a newer cloud CAS returns a new review and never a chosen state or cleared outbox',()=>{
  const input=fixture(),before=structuredClone(input);input.freshCloud.snapshotUpdatedAt='2026-10-13T00:02:00.654322+00:00';
  const result=prepareConflictResolution(input);assert.equal(result.status,'changed-cloud');
  assert.equal(result.review.cloudTimestamp,input.freshCloud.snapshotUpdatedAt);assert.deepEqual(result.cloud.transactions,input.freshCloud.state.transactions);
  assert.equal(result.candidate,undefined);assert.equal(result.readyRecord,undefined);
  assert.deepEqual(input.blockedOutbox,before.blockedOutbox);
  assert.equal(Object.isFrozen(result.review),true);assert.equal(Object.isFrozen(result.cloud.transactions[0]),true);
  const reconsidered=structuredClone(input);reconsidered.review={...result.review};assert.equal(prepareConflictResolution(reconsidered).status,'prepared');
});

for(const [name,mutate,code] of [
  ['cancelled',i=>i.current.cancelled=true,'cancelled'],
  ['late A-B-A session',i=>i.current.sessionGeneration=5,'stale-review'],
  ['logout',i=>i.current.ownerId=OTHER,'ownership'],
  ['foreign refreshed owner',i=>i.freshCloud.ownerId=OTHER,'ownership'],
  ['new local edit',i=>i.current.localRevision=3,'stale-review'],
  ['render revision mismatch',i=>i.local.localRevision=3,'stale-review'],
  ['changed configuration',i=>i.current.configId='other-project','configuration'],
  ['refreshed from another configuration',i=>i.freshCloud.configId='other-project','configuration'],
  ['changed current native key',i=>i.local.supabaseConfig.anonKey='other-key','configuration'],
  ['unverified refresh',i=>delete i.freshCloud.identityVerified,'unverified-cloud'],
  ['empty refresh',i=>i.freshCloud.isEmpty=true,'unverified-cloud'],
  ['legacy-only refresh',i=>i.freshCloud.snapshotUpdatedAt=null,'unverified-cloud'],
  ['missing refresh state',i=>delete i.freshCloud.state,'unverified-cloud'],
  ['blank reason',i=>i.reason='  ','invalid-reason'],
  ['oversized reason',i=>i.reason='x'.repeat(2049),'invalid-reason'],
  ['invalid choice',i=>i.choice='force-overwrite','invalid-reason'],
  ['foreign outbox',i=>i.blockedOutbox.ownerId=OTHER,'invalid-conflict'],
  ['outbox configuration mismatch',i=>i.blockedOutbox.configId='other-project','invalid-conflict'],
  ['ordinary stopped retry',i=>i.blockedOutbox.stop.reason='session','invalid-conflict'],
  ['no retained attempted version',i=>delete i.blockedOutbox.stop.attempted,'invalid-conflict'],
  ['invalid retained cloud',i=>i.blockedOutbox.stop.result.cloudState.accounts[0].balance=-1,'invalid-conflict'],
  ['pending ahead of cache',i=>i.blockedOutbox.pending.revision=3,'stale-review'],
  ['malformed financial record',i=>i.local.transactions[0].accountId='missing-account','invalid-state'],
  ['partial cloud',i=>delete i.freshCloud.state.budgets,'invalid-state'],
  ['foreign cloud audit',i=>i.freshCloud.state.financialAudit[0].ownerId=OTHER,'invalid-state'],
]) test(name+' refuses without changing input or releasing the conflict',()=>{
  const input=fixture();mutate(input);const before=structuredClone(input),result=prepareConflictResolution(input);
  assert.equal(result.status,'refused');assert.equal(result.code,code);assert.deepEqual(input,before);
  assert.equal(result.message.includes(secret),false);assert.equal(result.message.includes('missing-account'),false);
});

test('resolution revision exceeds every captured revision and rejects overflow',()=>{
  const input=fixture();input.blockedOutbox.acknowledgedRevision=40;
  assert.equal(prepared(input).revision,41);
  input.blockedOutbox.acknowledgedRevision=Number.MAX_SAFE_INTEGER;
  const result=prepareConflictResolution(input);assert.equal(result.status,'refused');assert.equal(result.code,'revision-overflow');
});

test('consumed reversed idempotency keys refuse keep-local instead of dropping the chosen rows',()=>{
  const input=fixture(),cloud=spend(base(),'local-1',10);
  input.freshCloud.state=appendFinancialAudit(cloud,engine.deleteTransactionMutation(cloud,'local-1'),metadata('reverse-local-1'));
  const before=structuredClone(input),result=prepareConflictResolution(input);
  assert.equal(result.status,'refused');assert.equal(result.code,'audit-reconciliation');assert.deepEqual(input,before);
});

test('nested child metadata and receipts survive a keep-local audit rebase completely',()=>{
  const input=fixture();let local=engine.createAccountMutation(base(),{id:'usd',name:'USD',bankName:'Cash',category:'cash_usd',currency:'USD',balance:0,isCash:true,color:'#000'});
  local=engine.createUsdDealMutation(local,{id:'deal',title:'Deal',totalUsdBought:10,buyRate:6,buyCommissionLyd:0,buyPaymentMethod:'cash',sourceLydAccountId:'cash',usdHoldingAccountId:'usd'});
  local=engine.sellFromUsdDealMutation(local,{saleId:'sale',dealId:'deal',usdAmount:2,sellRate:7,commissionLyd:0,paymentMethod:'cash',targetLydAccountId:'cash',sourceUsdAccountId:'usd'});
  local.deals[0].sales[0].preservedChild={labels:['nested','complete'],receipt:'data:image/png;base64,synthetic'};
  local.transactions[0].receiptImages=['data:image/png;base64,synthetic'];
  local.localRevision=2;local=json(local);input.local=local;input.blockedOutbox.pending.payload=structuredClone(local);
  const result=prepared(input);
  assert.deepEqual(result.candidate.deals,local.deals);assert.deepEqual(result.candidate.transactions,local.transactions);
  assert.deepEqual(result.evidence.latestLocal.deals[0].sales[0].preservedChild,local.deals[0].sales[0].preservedChild);
  validateFinancialAudit(result.candidate.financialAudit,result.candidate,OWNER);
});

test('malformed JSON-shaped metadata is rejected instead of silently serialized or executed',()=>{
  for(const value of [NaN,Infinity,()=>{},new Date(),new Map()]){
    const input=fixture();input.local.accounts[0].extra=value;
    assert.equal(prepareConflictResolution(input).status,'refused');
  }
  const input=fixture();input.local.accounts[0].extra=input.local.accounts[0];assert.equal(prepareConflictResolution(input).status,'refused');
});

test('raw timestamp spelling remains the reviewed CAS even for the same parsed instant',()=>{
  const input=fixture();input.review.cloudTimestamp='2026-10-13T00:02:00.654321Z';
  assert.equal(Date.parse(input.review.cloudTimestamp),Date.parse(input.freshCloud.snapshotUpdatedAt));
  assert.equal(prepareConflictResolution(input).status,'changed-cloud');
});

for(const stamp of ['infinity','-infinity','now','tomorrow','2026-10-13','2026-10-13T00:02:00','2026-02-30T00:00:00Z','2026-13-01T00:00:00Z','2026-01-01T24:00:00Z','0000-01-01T00:00:00Z','2026-01-01T00:00:00+16:00'])
  test('invalid raw CAS '+stamp+' cannot prepare a state',()=>{
    const input=fixture();input.freshCloud.snapshotUpdatedAt=stamp;input.review.cloudTimestamp=stamp;
    const result=prepareConflictResolution(input);assert.equal(result.status,'refused');assert.equal(result.code,'unverified-cloud');
  });

test('legacy no-audit cloud enrolls honestly and additional complete rate data remains valid',()=>{
  const input=fixture();input.freshCloud.state=base();
  input.freshCloud.state.marketRates.extraAccepted={source:'legacy',quote:6.5};
  delete input.local.financialAudit;
  input.local.marketRates.extraLocal={source:'local',quote:6.4};
  input.blockedOutbox.pending.payload=json(input.local);
  const result=prepared(input);
  assert.equal(result.candidate.financialAudit[0].action,'observed_baseline');
  assert.deepEqual(result.candidate.financialAudit[0].changes.find(change=>change.collection==='marketRates').after,input.freshCloud.state.marketRates);
  assert.deepEqual(result.candidate.marketRates,input.local.marketRates);
  validateFinancialAudit(result.candidate.financialAudit,result.candidate,OWNER);
  const adopted=fixture();adopted.choice='adopt-cloud';
  const changedRates=engine.updateMarketRatesMutation(adopted.freshCloud.state,{cashUsdToLyd:6.5});
  changedRates.marketRates.extraAccepted={source:'accepted',quote:6.5};
  adopted.freshCloud.state=json(appendFinancialAudit(adopted.freshCloud.state,changedRates,metadata('rates')));
  const cloudResult=prepared(adopted);
  assert.deepEqual(cloudResult.candidate.marketRates,adopted.freshCloud.state.marketRates);
  assert.deepEqual(cloudResult.candidate.financialAudit,adopted.freshCloud.state.financialAudit);
});

test('semantic evidence omits URL credential metadata while retaining complete financial record content',()=>{
  const input=fixture();input.local.supabaseConfig.url='https://username:password@auth.example.invalid/path?api_key=private#secret';
  const configId=syncConfigIdentity(input.local.supabaseConfig);
  input.review.configId=configId;input.current.configId=configId;input.freshCloud.configId=configId;input.blockedOutbox.configId=configId;
  input.blockedOutbox.pending.payload.supabaseConfig={...input.local.supabaseConfig};input.blockedOutbox.stop.attempted.payload.supabaseConfig={...input.local.supabaseConfig};
  const result=prepared(input),encoded=JSON.stringify(result.evidence);
  assert.equal(result.evidence.connection.url,'https://auth.example.invalid');
  for(const credential of ['username','password','private','api_key',secret])assert.equal(encoded.includes(credential),false);
  assert.deepEqual(result.evidence.latestLocal.transactions,input.local.transactions);
});
