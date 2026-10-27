import { createChunkedFinancialStorage } from '../src/services/chunkedFinancialStorage.ts';
import { appendFinancialAudit } from '../src/services/financialAudit.ts';
import { createAccountMutation, createUsdDealMutation, sellFromUsdDealMutation } from '../src/services/financialEngine.ts';
export const OWNER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';
export const DATE='2026-10-13T00:00:00.000Z';
export const keyFor=id=>'@mali_app_state_v2_'+id;
export const physical=id=>'@mali_financial_chunks_v1:'+encodeURIComponent(id);
export const copy=value=>JSON.parse(JSON.stringify(value));
export function financialState(owner=OWNER){
  const blank={accounts:[],contacts:[],transactions:[],deals:[],debts:[],procedures:[],budgets:[],marketRates:{cashUsdToLyd:6.2,chequeUsdToLyd:6.3,defaultChequeDiscountPercent:0,updatedAt:DATE},supabaseConfig:{url:'https://synthetic.example.invalid',anonKey:'PRIVATE-CONNECTION',workspaceKey:'mali-vault-'+owner,autoSync:false},lastModifiedAt:DATE};
  let state=createAccountMutation(blank,{id:'cash',name:'Cash',bankName:'Cash',category:'cash_lyd',currency:'LYD',balance:100,isCash:true,color:'#000'});
  state=createAccountMutation(state,{id:'usd',name:'USD',bankName:'Cash',category:'cash_usd',currency:'USD',balance:0,isCash:true,color:'#000'});
  state=createUsdDealMutation(state,{id:'deal',title:'Deal',totalUsdBought:10,buyRate:6,buyCommissionLyd:0,buyPaymentMethod:'cash',sourceLydAccountId:'cash',usdHoldingAccountId:'usd'});
  state=sellFromUsdDealMutation(state,{saleId:'sale',dealId:'deal',usdAmount:2,sellRate:7,commissionLyd:0,paymentMethod:'cash',targetLydAccountId:'cash',sourceUsdAccountId:'usd'});
  state.contacts=[{id:'contact',name:'Archived contact',phone:'000',role:'other',createdAt:DATE,child:{tags:['كامل',null]}}];
  state.debts=[{id:'debt',personName:'Archived debt',direction:'receivable',currency:'LYD',totalAmount:5,paidAmount:2,remainingAmount:3,status:'active',createdAt:DATE,installments:[{id:'payment',amount:2,date:DATE,proof:{nested:[1,false]}}]}];
  state.procedures=[{id:'procedure',title:'Procedure',stages:[{id:'stage',nested:{keep:true}}]}];
  state.budgets=[{id:'budget',title:'Budget',child:[{untouched:'original'}]}];
  state.marketRates.extension={nested:[{quote:6.4,source:'كامل'}]};
  state.deals[0].sales[0].extension={receipts:['data:image/png;base64,synthetic']};
  state.transactions[0].receiptImages=['data:image/png;base64,synthetic'];
  return copy(appendFinancialAudit(blank,state,{ownerId:owner,action:'financial_update',reason:'Synthetic complete version'}));
}
export function fixture(){
  const saved=new Map(),reads=[],writes=[];
  const backend={getItem:async key=>{reads.push(key);return saved.get(key)??null;},getAllKeys:async()=>[...saved.keys()],setItem:async(key,value)=>{writes.push(key);saved.set(key,value);},removeItem:async key=>{writes.push(key);saved.delete(key);}};
  const chunks=createChunkedFinancialStorage(backend);
  async function archive(owner=OWNER,options={}){
    const previous=options.previous??financialState(owner),incoming=options.incoming??financialState(owner);
    await chunks.setItem(keyFor(owner),typeof previous==='string'?previous:JSON.stringify({...previous,cloudOutbox:{private:'PRIVATE-OUTBOX'},authToken:'PRIVATE-AUTH'}));
    const id=await chunks.recoverItem(keyFor(owner),JSON.stringify(incoming),options.sourceEvidence??JSON.stringify(incoming));
    return {id,previous,incoming};
  }
  return {saved,reads,writes,backend,chunks,archive};
}
