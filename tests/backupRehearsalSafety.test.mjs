import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { checkedRehearsalUrl,checkedFixtureName,checkedContainerId,rehearseDatabaseRestore } from '../scripts/rehearseDatabaseRestore.mjs';

test('restore rehearsal refuses production endpoints and PG connection overrides before I/O',async()=>{
  for(const url of ['postgres://test@db.project.supabase.co/mali_test','postgres://test@127.0.0.1/postgres',
    'postgres://test@127.0.0.1/mali_test?host=production','postgres://test@127.0.0.1/mali_test?service=production',
    'postgres://test@127.0.0.1/mali_test#override','https://127.0.0.1/mali_test']) {
    await assert.rejects(rehearseDatabaseRestore(url));
  }
  assert.equal(checkedRehearsalUrl('postgres://test@localhost/mali_test').hostname,'127.0.0.1');
});
test('restore cleanup and container tools accept only fresh exact fixture identifiers',()=>{
  const uuid=randomUUID().replaceAll('-','');
  for(const suffix of ['source','restored']) {
    const name='mali_restore_test_'+uuid+'_'+suffix;assert.equal(checkedFixtureName(name),'"'+name+'"');
  }
  for(const name of ['mali_test','postgres','production','mali_restore_test_bad_source','mali_restore_test_'+uuid+'_other',
    'mali_restore_test_'+uuid+'_source";DROP DATABASE mali_test;--']) assert.throws(()=>checkedFixtureName(name));
  for(const id of ['postgres','--privileged','$(whoami)','a'.repeat(63),'../container']) assert.throws(()=>checkedContainerId(id));
  assert.equal(checkedContainerId('a'.repeat(64)),'a'.repeat(64));
});
