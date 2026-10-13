export interface FinancialStorageBackend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem?(key: string): Promise<void>;
  getAllKeys?(): Promise<readonly string[]>;
}
interface Head { version: 1; slot: 0 | 1; count: number; length: number; checksum: string }
const CHUNK_CHARACTERS = 65_536; // <=192KiB UTF-8, below Android CursorWindow limits.
const MAX_CHARACTERS = 48 * 1024 * 1024;
const namespace = (key: string) => '@mali_financial_chunks_v1:' + encodeURIComponent(key);
const backendQueues=new WeakMap<FinancialStorageBackend,Map<string,Promise<unknown>>>();

// Corruption detector only. Trusted financial immutability is enforced on the server.
function checksum(value: string) {
  let first=2166136261,second=5381;
  for(let i=0;i<value.length;i++) { const unit=value.charCodeAt(i);first=Math.imul(first^unit,16777619);second=Math.imul(second,33)^unit; }
  return (first>>>0).toString(16).padStart(8,'0')+(second>>>0).toString(16).padStart(8,'0');
}
function parseHead(raw: string): Head {
  const head=JSON.parse(raw) as Head;
  if(head?.version!==1 || ![0,1].includes(head.slot) || !Number.isSafeInteger(head.count) || head.count<1 ||
    !Number.isSafeInteger(head.length) || head.length<0 || head.length>MAX_CHARACTERS ||
    head.count<Math.max(1,Math.ceil(head.length/CHUNK_CHARACTERS)) ||
    head.count>Math.max(1,Math.ceil(head.length/(CHUNK_CHARACTERS-1))) || !/^[0-9a-f]{16}$/.test(head.checksum)) {
    throw new Error('Invalid financial cache head; recovery is required.');
  }
  return head;
}

/** Serial writes, verified inactive chunks and a small commit pointer preserve the old vault on failure.
 * On the web the wrapper also takes a cross-tab Web Lock; native work uses one JS runtime.
 * Never fall back to a stale legacy value when an existing chunk head is corrupt.
 */
export function createChunkedFinancialStorage(backend: FinancialStorageBackend,
  exclusive?: <T>(key: string, action: () => Promise<T>) => Promise<T>) {
  const queues=backendQueues.get(backend)||new Map<string,Promise<unknown>>();
  backendQueues.set(backend,queues);
  function serialize<T>(key: string, action: () => Promise<T>): Promise<T> {
    const operation=(queues.get(key)||Promise.resolve()).then(()=>exclusive?exclusive(key,action):action());
    const tail=operation.catch(()=>{});
    queues.set(key,tail);
    void tail.then(()=>{if(queues.get(key)===tail) queues.delete(key);});
    return operation;
  }
  const headKey=(key: string)=>namespace(key)+':head';
  const enrollmentKey=(key: string)=>namespace(key)+':enrolled';
  const partKey=(key: string,slot: number,index: number)=>namespace(key)+':'+slot+':'+index;
  async function readParts(key: string, head: Head): Promise<string> {
    const parts:string[]=[];
    for(let i=0;i<head.count;i++) {
      const part=await backend.getItem(partKey(key,head.slot,i));
      if(part===null || part.length>CHUNK_CHARACTERS || (i<head.count-1 && part.length<CHUNK_CHARACTERS-1)) {
        throw new Error('Incomplete financial cache; recovery is required.');
      }
      parts.push(part);
    }
    const raw=parts.join('');
    if(raw.length!==head.length || checksum(raw)!==head.checksum) throw new Error('Corrupt financial cache; recovery is required.');
    return raw;
  }
  async function read(key: string): Promise<string|null> {
    const rawHead=await backend.getItem(headKey(key));
    if(rawHead===null) {
      if(await backend.getItem(enrollmentKey(key))!==null) throw new Error('Missing enrolled financial cache; recovery is required.');
      return backend.getItem(key); // Lossless legacy read; provider validates original bytes.
    }
    return readParts(key,parseHead(rawHead));
  }
  async function write(key: string,value: string,recovery=false) {
      if(typeof value!=='string' || value.length>MAX_CHARACTERS) throw new Error('Financial cache exceeds the supported storage bound.');
      const priorRaw=await backend.getItem(headKey(key));
      if(!recovery && priorRaw===null && await backend.getItem(enrollmentKey(key))!==null) throw new Error('Missing enrolled financial cache; recovery is required.');
      let prior:Head|null=null;
      try {prior=priorRaw===null?null:parseHead(priorRaw);} catch(error){if(!recovery)throw error;}
      // Verify current bytes before replacing anything. A corrupt vault remains recoverable.
      if(prior && !recovery) await readParts(key,prior);
      const slot=prior?.slot===0?1:0;
      // The inactive slot is uncommitted; pruning it before replacement releases
      // stale large tails without touching the current acknowledged vault.
      if(backend.getAllKeys && backend.removeItem) {
        const prefix=namespace(key)+':'+slot+':';
        for(const part of await backend.getAllKeys()) {
          if(part.startsWith(prefix) && /^\d+$/.test(part.slice(prefix.length))) await backend.removeItem(part);
        }
      }
      const parts:string[]=[];
      for(let start=0;start<value.length;) {
        let end=Math.min(value.length,start+CHUNK_CHARACTERS);
        // Never split a supplementary Unicode character at a SQLite UTF-8 boundary.
        const last=value.charCodeAt(end-1),following=value.charCodeAt(end);
        if(last>=0xd800 && last<=0xdbff && following>=0xdc00 && following<=0xdfff) end--;
        parts.push(value.slice(start,end));start=end;
      }
      if(!parts.length)parts.push('');
      const count=parts.length;
      for(let i=0;i<count;i++) {
        const part=parts[i];
        const keyPart=partKey(key,slot,i);
        await backend.setItem(keyPart,part);
        if(await backend.getItem(keyPart)!==part) throw new Error('Unverified financial cache chunk.');
      }
      const next:Head={version:1,slot,count,length:value.length,checksum:checksum(value)};
      if(await readParts(key,next)!==value) throw new Error('Unverified financial cache.');
      const nextRaw=JSON.stringify(next);
      let headError:unknown;
      try { await backend.setItem(headKey(key),nextRaw); } catch(error) { headError=error; }
      // An interrupted acknowledgement can still be accepted only after exact durable read-back.
      if(await backend.getItem(headKey(key))!==nextRaw || await readParts(key,next)!==value) {
        throw headError || new Error('Unverified financial cache commit.');
      }
      // Separate durable enrollment prevents stale plaintext resurrection when
      // later corruption removes the head after failed legacy cleanup.
      if(await backend.getItem(enrollmentKey(key))!=='committed-v1') {
        await backend.setItem(enrollmentKey(key),'committed-v1');
        if(await backend.getItem(enrollmentKey(key))!=='committed-v1') throw new Error('Unverified financial cache enrollment.');
      }
      // Remove plaintext legacy duplication only after the replacement is fully verified.
      // Cleanup failure never invalidates a verified commit; the legacy value stays preserved.
      if(priorRaw===null && backend.removeItem) { try { await backend.removeItem(key); } catch {} }
  }
  let recoverySequence=0;
  return {
    getItem:(key: string)=>serialize(key,()=>read(key)),
    setItem:(key: string,value: string)=>serialize(key,()=>write(key,value)),
    /** Caller validates imported financial/owner evidence before requesting recovery.
     * Raw owned physical keys are copied and verified before replacing corrupt metadata.
     * Authentication/theme keys are neither read nor modified.
     */
    recoverItem:(key: string,value: string,sourceEvidence?: string,canCommit:()=>boolean=()=>true)=>serialize(key,async()=>{
      if(!canCommit())throw new Error('Cancelled financial recovery.');
      if(!backend.getAllKeys)throw new Error('Financial recovery requires a complete owned-key inventory.');
      const prefix=namespace(key)+':';
      const keys=(await backend.getAllKeys()).filter(name=>name===key || (name.startsWith(prefix) &&
        /^(head|enrolled|[01]:\d+)$/.test(name.slice(prefix.length))));
      const originals:{key:string;value:string}[]=[];
      for(const originalKey of keys) { const raw=await backend.getItem(originalKey);if(raw!==null)originals.push({key:originalKey,value:raw}); }
      const evidence=JSON.stringify({version:1,originalKey:key,capturedAt:new Date().toISOString(),originals,incoming:value,sourceEvidence});
      let evidenceKey:string;
      do { evidenceKey=key+'_recovery_'+Date.now()+'_'+(++recoverySequence); }
      while(await backend.getItem(headKey(evidenceKey))!==null || await backend.getItem(enrollmentKey(evidenceKey))!==null || await backend.getItem(evidenceKey)!==null);
      await serialize(evidenceKey,()=>write(evidenceKey,evidence));
      if(await read(evidenceKey)!==evidence)throw new Error('Unverified financial recovery evidence.');
      if(!canCommit())throw new Error('Cancelled financial recovery.');
      await write(key,value,true);
      return evidenceKey;
    }),
  };
}
