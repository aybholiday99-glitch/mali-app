import assert from 'node:assert/strict';
import test from 'node:test';
import {isAbsoluteTimestamp} from '../src/utils/absoluteTimestamp.ts';
test('strict absolute timestamps preserve exact server microseconds but reject parser comments and impossible calendars',()=>{
  for(const raw of ['2026-10-13T01:23:45.123456+00:00','2024-02-29T00:00:00Z','2000-02-29T23:59:59-15:59'])assert.equal(isAbsoluteTimestamp(raw),true,raw);
  for(const raw of ['2026-10-13 (PRIVATE)','2026-10-13','2026-02-30T00:00:00Z','1900-02-29T00:00:00Z','2026-01-01T24:00:00Z','2026-01-01T00:00:00+16:00','2026-01-01T00:00:00.1234567Z','0000-01-01T00:00:00Z'])assert.equal(isAbsoluteTimestamp(raw),false,raw);
});
