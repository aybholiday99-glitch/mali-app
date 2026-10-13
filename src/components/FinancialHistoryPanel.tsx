import React,{useEffect,useRef,useState} from 'react';
import {View,Text,TouchableOpacity,StyleSheet,ActivityIndicator} from 'react-native';
import {useMali} from '../context/MaliContext';
import {getSharedSupabaseClient} from '../services/authService';
import {readFinancialHistory,type ServerFinancialAcceptance} from '../services/financialHistoryReader';

const actions:Record<string,string>={observed_baseline:'حالة الخزنة عند بدء التسجيل',financial_update:'عملية مالية',balance_correction:'تصحيح الرصيد',transaction_reversal:'عكس حركة',deal_reversal:'عكس صفقة',debt_reversal:'عكس دين',backup_import:'استرجاع نسخة',conflict_resolution_keep_local:'اعتماد النسخة المحلية بعد تعارض'};
const collections:Record<string,string>={accounts:'الحسابات',contacts:'المتعاملون',transactions:'الحركات',deals:'صفقات الدولار',debts:'الديون',procedures:'الإجراءات',budgets:'الميزانيات',marketRates:'أسعار السوق'};
const date=(raw:string)=>new Date(raw).toLocaleString('ar-LY',{timeZone:'Africa/Tripoli'});

/** Read-only views of offline assertions and separately verified server acceptance. */
export function FinancialHistoryPanel(){
  const {state,currentUser}=useMali();
  const cfg=state.supabaseConfig;
  return <HistoryContents key={currentUser?.id+'::'+cfg.url+'::'+cfg.anonKey+'::'+cfg.workspaceKey}/>;
}
function HistoryContents(){
  const {state,theme,currentUser}=useMali();
  const [expanded,setExpanded]=useState(false),[visibleCount,setVisibleCount]=useState(20);
  const [server,setServer]=useState<ServerFinancialAcceptance[]>([]),[cursor,setCursor]=useState<number|undefined>();
  const [busy,setBusy]=useState(false),[message,setMessage]=useState<string|null>(null);
  const mounted=useRef(true),controller=useRef<AbortController|null>(null);
  const cfg=state.supabaseConfig;
  useEffect(()=>{const active=mounted,request=controller;active.current=true;
    return()=>{active.current=false;request.current?.abort();};},[]);
  const load=async(more=false)=>{
    if(busy || !currentUser || currentUser.isLocalOnly)return;
    controller.current?.abort();const request=new AbortController();controller.current=request;
    const isCurrent=()=>mounted.current && controller.current===request;
    setBusy(true);setMessage(null);
    const timeout=setTimeout(()=>request.abort(),15000);
    try{
      const result=await readFinancialHistory(getSharedSupabaseClient(cfg),cfg,currentUser,{before:more?cursor:undefined,signal:request.signal,isCurrent});
      if(!isCurrent())return;
      if(result.ok){setServer(previous=>more?[...previous,...result.rows]:result.rows);setCursor(result.nextCursor);setMessage(result.rows.length?'تواريخ القبول التالية صادرة عن الخادم الموثّق.':'لا توجد عمليات قبول مسجّلة لهذه الخزنة.');}
      else setMessage(result.message);
    }catch{if(isCurrent())setMessage('تعذر قراءة سجل الخادم. أعد المحاولة.');}
    finally{clearTimeout(timeout);if(isCurrent())setBusy(false);}
  };
  const history=state.financialAudit || [];
  return <View style={[styles.box,{borderColor:theme.border,backgroundColor:theme.cardAlt}]}>
    <TouchableOpacity accessibilityRole="button" accessibilityState={{expanded}} onPress={()=>setExpanded(!expanded)} style={styles.button}>
      <Text style={[styles.title,{color:theme.text}]}>السجل المالي · {history.length} حدث {expanded?'−':'+'}</Text>
    </TouchableOpacity>
    {expanded && <>
      <Text style={[styles.description,{color:theme.textSecondary}]}>يسجل التطبيق التعديلات والعكس دون حذف الدليل السابق. الوقت أدناه وقت الجهاز؛ قبول الخادم يظهر بصورة مستقلة. الحالة الأولى تصف ما كان موجوداً عند بدء التسجيل. النسخة الاحتياطية الكاملة تحتوي كل الأحداث.</Text>
      {!history.length && <Text style={[styles.description,{color:theme.textSecondary}]}>لم تُسجّل تغييرات بعد.</Text>}
      {history.slice(-visibleCount).reverse().map(event=><View key={event.id} style={[styles.event,{borderColor:theme.border}]}>
        <Text style={[styles.title,{color:theme.text}]}>{event.sequence}. {actions[event.action] || event.action}</Text>
        <Text style={[styles.description,{color:theme.textSecondary}]}>{event.reason} · {date(event.recordedAt)}</Text>
        {event.changes.slice(0,5).map((change,index)=><Text key={index} style={[styles.description,{color:theme.textSecondary}]}>{collections[change.collection]} · {change.recordId} · {change.after===null?'عكس أو إزالة من السجلات الحالية؛ الدليل محفوظ':change.before===null?'إضافة':'تعديل موثّق'}</Text>)}
        {event.changes.length>5 && <Text style={[styles.description,{color:theme.textSecondary}]}>و{event.changes.length-5} تغييرات أخرى في النسخة الكاملة.</Text>}
      </View>)}
      {visibleCount<history.length && <TouchableOpacity accessibilityRole="button" onPress={()=>setVisibleCount(n=>n+20)} style={styles.button}><Text style={{color:theme.primary}}>عرض 20 حدثاً أقدم</Text></TouchableOpacity>}
      {currentUser && !currentUser.isLocalOnly && <>
        <TouchableOpacity accessibilityRole="button" disabled={busy} accessibilityState={{disabled:busy,busy}} onPress={()=>void load()} style={styles.button}><Text style={{color:theme.primary}}>قراءة تواريخ قبول الخادم</Text>{busy && <ActivityIndicator color={theme.primary}/>}</TouchableOpacity>
        {message && <Text accessibilityRole="alert" style={[styles.description,{color:theme.textSecondary}]}>{message}</Text>}
        {server.map(row=><Text key={row.history_id} style={[styles.description,{color:theme.text}]}>#{row.history_id} · {row.event_type==='observed_baseline'?'حالة البداية الملاحظة':row.event_type==='snapshot_deleted'?'إزالة نسخة الخزنة مع حفظ تاريخها':'قبول نسخة الخزنة'} · {date(row.accepted_at)}</Text>)}
        {cursor && <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={()=>void load(true)} style={styles.button}><Text style={{color:theme.primary}}>قبول أقدم على الخادم</Text></TouchableOpacity>}
      </>}
    </>}
  </View>;
}
const styles=StyleSheet.create({box:{borderWidth:1,borderRadius:14,padding:12,marginBottom:16},button:{minHeight:44,paddingVertical:8,flexDirection:'row-reverse',gap:8,alignItems:'center'},title:{fontSize:14,fontWeight:'600',textAlign:'right'},description:{fontSize:12,textAlign:'right',lineHeight:20,marginVertical:4},event:{borderTopWidth:1,paddingVertical:10}});
