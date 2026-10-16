import assert from 'node:assert/strict';
import { test } from 'node:test';
import { financialPreview, parseFinancialInput } from '../src/utils/financialInput.ts';

test('financial input reads complete decimal values and explicit thousands grouping', () => {
  for (const [input, expected] of [['5',5],['  5.25  ',5.25],['.5',0.5],['-2.5',-2.5],['+10',10],
    ['1,000',1000],['12,345,678.90',12345678.9],['0005.50',5.5],['0',0]]) {
    assert.equal(parseFinancialInput(input),expected,input);
  }
});

test('Arabic and Eastern Arabic digits and separators retain the intended amount', () => {
  for (const [input, expected] of [['١٬٢٣٤٫٥٦',1234.56],['۱٬۲۳۴٫۵۶',1234.56],['١,٠٠٠.٢٥',1000.25],
    ['٥٫٥',5.5],['٫٥',0.5],['-٢٥',-25],['١٠٠٠',1000],['1٬000٫25',1000.25]]) {
    assert.equal(parseFinancialInput(input),expected,input);
  }
});

test('partial values, exponent/hex notation and nonfinite values are rejected rather than truncated', () => {
  for (const input of ['5junk','5 LYD','0x10','0b10','1e3','1E-2','Infinity','NaN','5.','.',',','+','--5',
    '1 000','1\n000','5\u200b','١٢abc','٥٫']) assert.equal(parseFinancialInput(input),null,input);
});

test('irregular and ambiguous grouping cannot turn a decimal into a different amount', () => {
  for (const input of ['1,00','5,5','12,34,567','1234,567','1,,000',',000','1,000,','1.000,50',
    '1,000٬000','١٬٠٠','1.2٫3','١٫٢٫٣','1,000.2,5']) assert.equal(parseFinancialInput(input),null,input);
});

test('only explicit optional blanks become zero; malformed commissions remain invalid', () => {
  for (const input of ['','   ']) {
    assert.equal(parseFinancialInput(input),null);
    assert.equal(parseFinancialInput(input,{optional:true}),0);
  }
  for (const input of ['fee','5junk','0x0','1,2','Infinity']) {
    assert.equal(parseFinancialInput(input,{optional:true}),null,input);
  }
  assert.equal(parseFinancialInput('٠',{optional:true}),0);
});

test('overflow, unsafe integer precision and nonzero underflow are rejected', () => {
  for (const input of ['9'.repeat(400),'9007199254740992','0.'+'0'.repeat(400)+'1']) {
    assert.equal(parseFinancialInput(input),null,input.slice(0,30));
  }
  assert.equal(parseFinancialInput('1000000000001'),1000000000001,'domain limits remain with the financial engine');
});

test('display-only previews stay finite for incomplete inputs and overflowing calculations', () => {
  for (const value of [null,Infinity,-Infinity,NaN,1e100,Number.MAX_VALUE * 10]) assert.equal(financialPreview(value),0);
  assert.equal(financialPreview(parseFinancialInput('5junk')),0);
  assert.equal(financialPreview(12.345,2),12.35);
  assert.equal(financialPreview(6.23456,4),6.2346);
  assert.equal(financialPreview(-5.5),-5.5);
  assert.equal(financialPreview(10.075),10.08);
  assert.equal(financialPreview(-10.075),-10.08);
});
