import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {performance} from 'node:perf_hooks';

const require=createRequire(import.meta.url);
const routerRequire=createRequire(require.resolve('expo-router/package.json'));
const query=routerRequire('query-string');

test('actual Router query parser preserves Arabic, PKCE code, repeated arrays and serialization with the fixed decoder',()=>{
  const parsed=query.parse('name=%D9%85%D8%A7%D9%84%D9%8A&code=a%2Bb%2Fc&tag=1&tag=2&empty=&flag');
  assert.deepEqual({...parsed},{code:'a+b/c',empty:'',flag:null,name:'مالي',tag:['1','2']});
  assert.deepEqual({...query.parse(query.stringify(parsed))},{...parsed});
  assert.deepEqual({...query.parse('array[]=a&array[]=b',{arrayFormat:'bracket'})},{array:['a','b']});
  assert.equal(query.parse('broken=%C3%28&valid=%F0%9F%98%80').valid,'😀');
});

test('actual Router consumer completes malicious malformed UTF-8 decoding within a bounded test deadline',{timeout:3000},()=>{
  const started=performance.now();
  const attack='%80'.repeat(20000)+'%C3%28';
  const parsed=query.parse('value='+attack);
  assert.equal(typeof parsed.value,'string');assert.ok(parsed.value.includes('%80'));
  assert.ok(performance.now()-started<2500);
});
