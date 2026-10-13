import type {AuthUser, SupabaseConfig} from '../types/mali';
import {isAbsoluteTimestamp} from '../utils/absoluteTimestamp.ts';

export interface ServerFinancialAcceptance {
  history_id: number;
  user_id: string;
  workspace_key: string;
  actor_id: string | null;
  accepted_at: string;
  snapshot_updated_at: string;
  event_type: 'observed_baseline' | 'cloud_commit' | 'snapshot_deleted';
}
interface HistoryClient {
  auth: {getUser(): Promise<{data:{user:{id:string}|null};error:unknown}>};
  from(table:string): any;
}
type HistoryResult = {ok:true;rows:ServerFinancialAcceptance[];nextCursor?:number} | {ok:false;message:string};
const failed=():HistoryResult=>({ok:false,message:'تعذر توثيق أو قراءة سجل الخادم. قد لا تكون ترحيلة السجل مفعّلة أو انتهت الجلسة. بقي سجل الجهاز محفوظاً.'});
const PAGE_SIZE=30;

/** Owner-filtered keyset page; no credential, financial image, or history-write request. */
export async function readFinancialHistory(client:HistoryClient,config:SupabaseConfig,user:AuthUser|null,
  options:{before?:number;signal:AbortSignal;isCurrent():boolean}):Promise<HistoryResult>{
  const current=()=>!options.signal.aborted && options.isCurrent();
  if(!current() || !user?.id || user.isLocalOnly || !config.workspaceKey.trim()
    || (options.before!==undefined && (!Number.isSafeInteger(options.before)||options.before<=0)))return failed();
  let abort:()=>void=()=>{};
  try {
    return await Promise.race([ (async():Promise<HistoryResult>=>{
      const verified=await client.auth.getUser();
      if(!current() || verified.error || verified.data?.user?.id!==user.id)return failed();
      let query=client.from('mali_financial_history').select('history_id,user_id,workspace_key,actor_id,accepted_at,snapshot_updated_at,event_type')
        .eq('user_id',user.id).eq('workspace_key',config.workspaceKey).order('history_id',{ascending:false}).limit(PAGE_SIZE);
      if(options.before!==undefined)query=query.lt('history_id',options.before);
      const {data,error}=await query.abortSignal(options.signal);
      if(!current() || error || !Array.isArray(data) || data.length>PAGE_SIZE)return failed();
      let previous=options.before ?? Number.MAX_SAFE_INTEGER;
      const rows:ServerFinancialAcceptance[]=[];
      for(const row of data){
        if(!row || !Number.isSafeInteger(row.history_id) || row.history_id<=0 || row.history_id>=previous
          || row.user_id!==user.id || row.workspace_key!==config.workspaceKey
          || (row.actor_id!==null && row.actor_id!==user.id) || !isAbsoluteTimestamp(row.accepted_at) || !isAbsoluteTimestamp(row.snapshot_updated_at)
          || !['observed_baseline','cloud_commit','snapshot_deleted'].includes(row.event_type))return failed();
        rows.push({history_id:row.history_id,user_id:row.user_id,workspace_key:row.workspace_key,actor_id:row.actor_id,
          accepted_at:row.accepted_at,snapshot_updated_at:row.snapshot_updated_at,event_type:row.event_type});previous=row.history_id;
      }
      const after=await client.auth.getUser();
      if(!current() || after.error || after.data?.user?.id!==user.id)return failed();
      return {ok:true,rows,nextCursor:rows.length===PAGE_SIZE?previous:undefined};
    })(),new Promise<HistoryResult>(resolve=>{
      abort=()=>resolve(failed());options.signal.addEventListener('abort',abort,{once:true});if(!current())abort();
    })]);
  }catch{return failed();}finally{options.signal.removeEventListener('abort',abort);}
}
