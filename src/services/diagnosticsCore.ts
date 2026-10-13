import type {MaliState} from '../types/mali';
import type {CloudSyncStatus} from './durableSyncWorker';
const count=(rows:unknown)=>Array.isArray(rows)?rows.length:0;
const integer=(value:unknown)=>Number.isSafeInteger(value) && Number(value)>=0?value:undefined;
const timestamp=(value:unknown)=>typeof value==='string' && value.length<=64 && Number.isFinite(Date.parse(value))?value:undefined;

/** Explicit allowlist: support reports never serialize state, config, rows or errors. */
export function createSafeDiagnostics(state:MaliState,status:CloudSyncStatus<MaliState>,platform:string,localOnly:boolean){
  const phases=['idle','pending','uploading','retrying','paused','blocked','storage-error'];
  const reasons=['conflict','session','configuration','permanent'];
  const outbox=status.outbox;
  return {formatVersion:1,appVersion:'1.0.0',createdAt:new Date().toISOString(),
    platform:['web','android','ios'].includes(platform)?platform:'unknown',mode:localOnly?'local':'cloud',
    localRevision:integer(state.localRevision),pendingCloudSync:state.pendingCloudSync===true,
    sync:{phase:phases.includes(status.phase)?status.phase:'unknown',attempts:integer(outbox?.attempts),
      nextAttemptAt:typeof outbox?.nextAttemptAt==='number' && Number.isFinite(outbox.nextAttemptAt)?outbox.nextAttemptAt:undefined,
      pendingRevision:integer(outbox?.pending?.revision),acknowledgedRevision:integer(outbox?.acknowledgedRevision),syncedAt:timestamp(outbox?.syncedAt),
      stopReason:reasons.includes(outbox?.stop?.reason||'')?outbox?.stop?.reason:undefined},
    counts:{accounts:count(state.accounts),contacts:count(state.contacts),transactions:count(state.transactions),deals:count(state.deals),
      debts:count(state.debts),procedures:count(state.procedures),budgets:count(state.budgets),auditEvents:count(state.financialAudit)},
  };
}
