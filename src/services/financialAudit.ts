import type { MaliState } from '../types/mali';
import type { FinancialAuditChange, FinancialAuditCollection, FinancialAuditEvent, FinancialAuditMetadata } from '../types/financialAudit';

export const MAX_FINANCIAL_AUDIT_BYTES = 48 * 1024 * 1024;
export const MAX_FINANCIAL_AUDIT_EVENTS = 10000;
export const MAX_FINANCIAL_AUDIT_CHANGES = 100000;
const COLLECTIONS: FinancialAuditCollection[] = ['accounts', 'contacts', 'transactions', 'deals', 'debts', 'procedures', 'budgets', 'marketRates'];
const invalid = () => new Error('سجل التدقيق المالي غير صالح أو تجاوز حد الحفظ. لا يجوز حذف دليل سابق.');
const text = (value: unknown, maximum: number): value is string => typeof value === 'string' && !!value.trim() && value.length <= maximum;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
let sequence = 0;
const eventId = () => `fa-${Date.now()}-${++sequence}-${Math.random().toString(36).slice(2, 14)}`;

/** Canonical JSON evidence omits optional undefined object fields, never numbers. */
function canonical(value: unknown, depth = 0): any {
  if (depth > 64) throw invalid();
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(item => canonical(item, depth + 1));
  if (!record(value)) throw invalid();
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] !== undefined) Object.defineProperty(result, key, { value: canonical(value[key], depth + 1), enumerable: true });
  }
  return result;
}
const equal = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
/** Retain submission identity after the corresponding live row has been reversed. */
export function financialOperationKeys(previous:MaliState,next:MaliState):string[] {
  const entries=(state:MaliState)=>[
    ...state.deals.map(row=>({key:'deal:'+row.id,operation:row.idempotencyKey})),
    ...state.transactions.map(row=>({key:'transaction:'+row.id,operation:row.idempotencyKey})),
    ...state.debts.map(row=>({key:'debt:'+row.id,operation:row.idempotencyKey})),
    ...state.deals.flatMap(row=>row.sales.map(sale=>({key:'sale:'+sale.id,operation:sale.idempotencyKey}))),
    ...state.debts.flatMap(row=>row.installments.map(payment=>({key:'payment:'+payment.id,operation:payment.idempotencyKey}))),
  ];
  const old=new Set(entries(previous).map(row=>row.key));
  return [...new Set(entries(next).filter(row=>!old.has(row.key) && row.operation).map(row=>row.operation!))];
}
export const financialOperationId=(previous:MaliState,next:MaliState)=>financialOperationKeys(previous,next)[0];
function utf8Bytes(value: string) {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit < 128) bytes++;
    else if (unit < 2048) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
    else bytes += 3;
  }
  return bytes;
}
function bounded(value: unknown) {
  const encoded = JSON.stringify(value);
  if (!encoded || encoded.length > MAX_FINANCIAL_AUDIT_BYTES || utf8Bytes(encoded) > MAX_FINANCIAL_AUDIT_BYTES) throw invalid();
}
function image(collection: FinancialAuditCollection, id: string, value: unknown) {
  if (value === null) return null;
  if (!record(value) || (collection !== 'marketRates' && value.id !== id)) throw invalid();
  return canonical(value) as Record<string, unknown>;
}
function rows(state: MaliState) {
  const result = new Map<string, { collection: FinancialAuditCollection; recordId: string; value: Record<string, unknown> }>();
  for (const collection of COLLECTIONS) {
    const values = collection === 'marketRates' ? [state.marketRates] : state[collection];
    if (!Array.isArray(values)) throw invalid();
    for (const value of values) {
      const id = collection === 'marketRates' ? 'marketRates' : (value as { id: string }).id;
      if (!text(id, 256)) throw invalid();
      const key = `${collection}:${id}`;
      if (result.has(key)) throw invalid();
      result.set(key, { collection, recordId: id, value: image(collection, id, value)! });
    }
  }
  return result;
}

/** Replays claimed row changes. It cannot authenticate unsynced device history. */
export function validateFinancialAudit(value: unknown, state?: MaliState, expectedOwner?: string): FinancialAuditEvent[] {
  if (!Array.isArray(value) || value.length > MAX_FINANCIAL_AUDIT_EVENTS) throw invalid();
  bounded(value);
  const events: FinancialAuditEvent[] = [];
  const ids = new Set<string>(), operations = new Set<string>();
  const current = new Map<string, Record<string, unknown>>();
  let owner = expectedOwner;
  for (let i = 0; i < value.length; i++) {
    const event = value[i];
    if (!record(event) || event.version !== 1 || !text(event.id, 256) || ids.has(event.id) || event.sequence !== i + 1 ||
        !text(event.ownerId, 256) || !text(event.action, 128) || !text(event.reason, 2048) ||
        typeof event.recordedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(event.recordedAt) ||
        event.recordedAt.startsWith('0000') || !Number.isFinite(Date.parse(event.recordedAt)) || new Date(event.recordedAt).toISOString() !== event.recordedAt ||
        !Array.isArray(event.changes) || event.changes.length > MAX_FINANCIAL_AUDIT_CHANGES ||
        (i === 0 ? event.action !== 'observed_baseline' : event.action === 'observed_baseline') ||
        (i > 0 && event.changes.length === 0)) throw invalid();
    owner ??= event.ownerId;
    if (owner !== event.ownerId) throw invalid();
    if (event.operationId !== undefined) {
      if (!text(event.operationId, 256) || operations.has(event.operationId)) throw invalid();
      operations.add(event.operationId);
    }
    ids.add(event.id);
    const changed = new Set<string>();
    for (const change of event.changes) {
      if (!record(change) || !COLLECTIONS.includes(change.collection as FinancialAuditCollection) || !text(change.recordId, 256)) throw invalid();
      const collection = change.collection as FinancialAuditCollection;
      if (collection === 'marketRates' && change.recordId !== 'marketRates') throw invalid();
      const key = `${collection}:${change.recordId}`;
      const before = image(collection, change.recordId, change.before), after = image(collection, change.recordId, change.after);
      if (changed.has(key) || (before === null && after === null) || equal(before, after) ||
          (i === 0 && before !== null) || !equal(current.get(key) ?? null, before)) throw invalid();
      changed.add(key);
      if (after === null) current.delete(key); else current.set(key, after);
    }
    events.push(canonical(event));
  }
  // [] is a legacy/uninitialized journal, not an invented audited baseline.
  if (state && events.length) {
    const expected = rows(state);
    if (expected.size !== current.size || [...expected].some(([key, row]) => !equal(row.value, current.get(key) ?? null))) throw invalid();
  }
  return events;
}

export function appendFinancialAudit(previous: MaliState, next: MaliState, metadata: FinancialAuditMetadata): MaliState {
  if (previous === next) return previous;
  if (!text(metadata.ownerId, 256) || !text(metadata.action, 128) || metadata.action === 'observed_baseline' || !text(metadata.reason, 2048) ||
      (metadata.operationId !== undefined && !text(metadata.operationId, 256))) throw invalid();
  const history = validateFinancialAudit(previous.financialAudit ?? [], previous, metadata.ownerId);
  if (metadata.operationId && history.some(event => event.operationId === metadata.operationId)) return previous;
  const retainedKeys=new Set<string>();
  for(const event of history) for(const change of event.changes) {
    if(!['deals','transactions','debts'].includes(change.collection))continue;
    for(const evidence of [change.before,change.after]) {
      if(!evidence)continue;
      const values=[evidence,...(Array.isArray(evidence.sales)?evidence.sales:[]),...(Array.isArray(evidence.installments)?evidence.installments:[])];
      for(const value of values)if(typeof value?.idempotencyKey==='string')retainedKeys.add(value.idempotencyKey);
    }
  }
  if(financialOperationKeys(previous,next).some(key=>retainedKeys.has(key)))return previous;
  // Candidate mutators/imports cannot supply a replacement for existing history.
  if (next.financialAudit !== undefined && !equal(next.financialAudit, previous.financialAudit ?? [])) throw invalid();
  const before = rows(previous), after = rows(next), changes: FinancialAuditChange[] = [];
  for (const key of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const old = before.get(key), fresh = after.get(key);
    if (equal(old?.value ?? null, fresh?.value ?? null)) continue;
    const row = fresh ?? old!;
    changes.push({ collection: row.collection, recordId: row.recordId, before: old?.value ?? null, after: fresh?.value ?? null });
  }
  if (!changes.length) return { ...next, ...(previous.financialAudit ? { financialAudit: history } : {}) };
  const recordedAt = new Date().toISOString();
  if (!history.length) history.push({ version: 1, id: eventId(), sequence: 1, ownerId: metadata.ownerId,
    action: 'observed_baseline', reason: 'Existing records observed at audit enrollment; earlier business chronology is unknown.', recordedAt,
    changes: [...before.values()].map(row => ({ collection: row.collection, recordId: row.recordId, before: null, after: row.value })) });
  history.push({ version: 1, id: eventId(), sequence: history.length + 1, ...metadata, recordedAt, changes });
  return { ...next, financialAudit: validateFinancialAudit(history, next, metadata.ownerId) };
}
