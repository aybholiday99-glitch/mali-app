type TaggedValue = unknown[];

export interface FinancialInputSnapshot<T> {
  readonly value: T;
  readonly fingerprint: string;
}

/** Detach plain command data without invoking getters/toJSON or dropping explicit clears. */
export function snapshotFinancialInput<T extends object>(input: T, kind: 'object' | 'array' = 'object'): FinancialInputSnapshot<T> {
  const invalid = () => new Error('Invalid financial command data.');
  if (!input || typeof input !== 'object' || Array.isArray(input) !== (kind === 'array')) throw invalid();
  const active = new Set<object>();
  let nodes = 0;
  function copy(value: unknown, depth: number): { value: unknown; tag: TaggedValue } {
    if (++nodes > 100_000 || depth > 64) throw invalid();
    if (value === undefined) return { value, tag: ['undefined'] };
    if (value === null) return { value, tag: ['null'] };
    if (typeof value === 'string' || typeof value === 'boolean') return { value, tag: [typeof value, value] };
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw invalid();
      return { value, tag: ['number', Object.is(value, -0) ? '-0' : value.toString()] };
    }
    if (typeof value !== 'object' || active.has(value)) throw invalid();
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw invalid();
    active.add(value);
    try {
      const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
      if (keys.some(key => typeof key !== 'string' || key === 'toJSON')) throw invalid();
      for (const key of keys as string[]) {
        const descriptor = descriptors[key];
        if (!('value' in descriptor) || (!descriptor.enumerable && !(array && key === 'length'))) throw invalid();
      }
      if (array) {
        const length = descriptors.length.value;
        if (!Number.isSafeInteger(length) || length < 0 || length > 100_000 || keys.length !== length + 1) throw invalid();
        const result: unknown[] = [], tags: TaggedValue[] = [];
        for (let index = 0; index < length; index++) {
          const descriptor = descriptors[String(index)];
          if (!descriptor || descriptor.value === undefined) throw invalid();
          const entry = copy(descriptor.value, depth + 1);
          result.push(entry.value); tags.push(entry.tag);
        }
        return { value: Object.freeze(result), tag: ['array', tags] };
      }
      const result = Object.create(null) as Record<string, unknown>, tags: [string, TaggedValue][] = [];
      for (const key of (keys as string[]).sort()) {
        const entry = copy(descriptors[key].value, depth + 1);
        Object.defineProperty(result, key, { value: entry.value, enumerable: true });
        tags.push([key, entry.tag]);
      }
      return { value: Object.freeze(result), tag: ['object', tags] };
    } finally { active.delete(value); }
  }
  const captured = copy(input, 0);
  return Object.freeze({ value: captured.value as T, fingerprint: JSON.stringify(captured.tag) });
}
