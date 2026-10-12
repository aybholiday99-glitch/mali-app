import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://evcwoaerlykghgdevrhb.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_thjoIAP26oAUvYPMPUJoJQ_uhex9L6s';

const TABLES = [
  'mali_vault_snapshots',
  'mali_accounts',
  'mali_contacts',
  'mali_usd_deals',
  'mali_transactions',
  'mali_debts',
];

function makeClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function runRlsAndIsolationTests() {
  console.log('=== Starting Live Supabase RLS & Multi-User Isolation Tests ===');

  // 1. Test Anonymous (unauthenticated) access across all 6 tables + RPC function
  const anonClient = makeClient();
  for (const table of TABLES) {
    const { data, error } = await anonClient.from(table).select('*');
    assert.ok(
      error || !data || data.length === 0,
      `Anon SELECT on ${table} must be denied or return 0 rows`
    );

    const dummyInsert =
      table === 'mali_vault_snapshots'
        ? { workspace_key: 'anon-hack-attempt', payload: {} }
        : { id: 'anon-1', workspace_key: 'anon-hack-attempt' };
    const { error: insErr } = await anonClient.from(table).insert(dummyInsert);
    assert.ok(insErr, `Anon INSERT on ${table} must be rejected by GRANT/RLS`);
  }

  // Test anon execution of handle_mali_auto_confirm_user
  const { error: rpcErr } = await anonClient.rpc('handle_mali_auto_confirm_user');
  assert.ok(rpcErr, 'Anon execution of handle_mali_auto_confirm_user must be rejected');
  console.log('[PASS] Anonymous access to all 6 tables and trigger function is strictly blocked.');

  // 2. Create two separate authenticated test users (User A & User B)
  const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const emailA = `mali.audit.usera.${runId}@example.com`;
  const emailB = `mali.audit.userb.${runId}@example.com`;
  const strongPassword = `MaliAudit#${runId}!99`;

  const clientA = makeClient();
  const clientB = makeClient();

  const signUpA = await clientA.auth.signUp({ email: emailA, password: strongPassword });
  assert.ifError(signUpA.error);
  const userAId = signUpA.data.user?.id;
  assert.ok(userAId, 'User A must receive a valid UUID');

  if (!signUpA.data.session) {
    const loginA = await clientA.auth.signInWithPassword({ email: emailA, password: strongPassword });
    assert.ifError(loginA.error);
  }

  const signUpB = await clientB.auth.signUp({ email: emailB, password: strongPassword });
  assert.ifError(signUpB.error);
  const userBId = signUpB.data.user?.id;
  assert.ok(userBId, 'User B must receive a valid UUID');

  if (!signUpB.data.session) {
    const loginB = await clientB.auth.signInWithPassword({ email: emailB, password: strongPassword });
    assert.ifError(loginB.error);
  }

  assert.notEqual(userAId, userBId, 'User A and User B must have distinct user IDs');
  console.log('[PASS] Authenticated test users User A and User B created and signed in.');

  const wsA = `mali-vault-${userAId}`;
  const wsB = `mali-vault-${userBId}`;

  try {
    // 3. Insert records for User A across all 6 tables
    assert.ifError(
      (
        await clientA.from('mali_vault_snapshots').upsert({
          workspace_key: wsA,
          user_id: userAId,
          payload: { owner: 'UserA', secretBalance: 50000 },
        })
      ).error
    );
    assert.ifError(
      (
        await clientA.from('mali_accounts').upsert({
          id: 'acc-a-1',
          workspace_key: wsA,
          user_id: userAId,
          name: 'User A Cash',
          bank_name: 'Cash',
          category: 'cash_lyd',
          currency: 'LYD',
          balance: 50000,
          is_cash: true,
        })
      ).error
    );
    assert.ifError(
      (
        await clientA.from('mali_contacts').upsert({
          id: 'cnt-a-1',
          workspace_key: wsA,
          user_id: userAId,
          name: 'Contact A',
          phone: '0910000001',
          role: 'تاجر عملة',
        })
      ).error
    );
    assert.ifError(
      (
        await clientA.from('mali_usd_deals').upsert({
          id: 'deal-a-1',
          workspace_key: wsA,
          user_id: userAId,
          deal_number: 'DL-A01',
          title: 'Deal A',
          counterparty: 'Trader A',
          buy_date: '2026-10-12',
          usd_amount: 1000,
          buy_rate: 6.2,
          effective_buy_rate: 6.2,
          total_lyd_cost: 6200,
          buy_method: 'cash',
          source_lyd_account_id: 'acc-a-1',
          target_usd_account_id: 'acc-a-2',
          remaining_usd: 1000,
          status: 'open',
        })
      ).error
    );
    assert.ifError(
      (
        await clientA.from('mali_transactions').upsert({
          id: 'tx-a-1',
          workspace_key: wsA,
          user_id: userAId,
          title: 'Tx A',
          type: 'expense',
          amount: 150,
          currency: 'LYD',
          category: 'عام',
          account_id: 'acc-a-1',
          payment_method: 'cash',
          tx_date: '2026-10-12',
        })
      ).error
    );
    assert.ifError(
      (
        await clientA.from('mali_debts').upsert({
          id: 'debt-a-1',
          workspace_key: wsA,
          user_id: userAId,
          person_name: 'Debtor A',
          direction: 'receivable',
          currency: 'LYD',
          total_amount: 2000,
          paid_amount: 0,
          remaining_amount: 2000,
          created_at: '2026-10-12',
          status: 'active',
        })
      ).error
    );

    // 4. Insert records for User B across all 6 tables
    assert.ifError(
      (
        await clientB.from('mali_vault_snapshots').upsert({
          workspace_key: wsB,
          user_id: userBId,
          payload: { owner: 'UserB', secretBalance: 99000 },
        })
      ).error
    );
    assert.ifError(
      (
        await clientB.from('mali_accounts').upsert({
          id: 'acc-b-1',
          workspace_key: wsB,
          user_id: userBId,
          name: 'User B Cash',
          bank_name: 'Cash',
          category: 'cash_lyd',
          currency: 'LYD',
          balance: 99000,
          is_cash: true,
        })
      ).error
    );

    // 5. Verify User A CANNOT read User B's data across any of the 6 tables
    for (const table of TABLES) {
      const { data: rowsForA, error: errA } = await clientA.from(table).select('*');
      assert.ifError(errA);
      for (const row of rowsForA || []) {
        assert.equal(
          row.user_id,
          userAId,
          `User A saw a row in ${table} not owned by User A!`
        );
      }

      const { data: rowsForB, error: errB } = await clientB.from(table).select('*');
      assert.ifError(errB);
      for (const row of rowsForB || []) {
        assert.equal(
          row.user_id,
          userBId,
          `User B saw a row in ${table} not owned by User B!`
        );
      }
    }
    console.log('[PASS] Strict SELECT isolation verified across all 6 tables (User A <-> User B).');

    // 6. Verify User B CANNOT insert a row spoofing User A's user_id or NULL user_id
    const { error: spoofErr } = await clientB.from('mali_accounts').insert({
      id: 'acc-spoof',
      workspace_key: wsA,
      user_id: userAId,
      name: 'Spoofed Account',
      bank_name: 'Spoof',
      category: 'cash_lyd',
      currency: 'LYD',
      balance: 0,
      is_cash: true,
    });
    assert.ok(spoofErr, 'User B must be blocked from inserting a row with User A user_id');

    const { error: nullUserErr } = await clientB.from('mali_accounts').insert({
      id: 'acc-null',
      workspace_key: wsB,
      user_id: null,
      name: 'Null User Account',
      bank_name: 'Null',
      category: 'cash_lyd',
      currency: 'LYD',
      balance: 0,
      is_cash: true,
    });
    assert.ok(nullUserErr, 'Inserting a row with user_id = NULL must be rejected');

    // 7. Verify User B CANNOT update or delete User A's rows
    const { data: updData } = await clientB
      .from('mali_accounts')
      .update({ balance: 0 })
      .eq('workspace_key', wsA)
      .eq('id', 'acc-a-1')
      .select();
    assert.equal(updData?.length || 0, 0, 'User B must not be able to update User A rows');

    const { data: delData } = await clientB
      .from('mali_accounts')
      .delete()
      .eq('workspace_key', wsA)
      .eq('id', 'acc-a-1')
      .select();
    assert.equal(delData?.length || 0, 0, 'User B must not be able to delete User A rows');

    // Verify User A's account balance is still intact at 50000
    const { data: checkA } = await clientA
      .from('mali_accounts')
      .select('balance')
      .eq('id', 'acc-a-1')
      .single();
    assert.equal(Number(checkA.balance), 50000, 'User A balance must remain untouched at 50000');
    console.log('[PASS] Cross-user INSERT spoofing, UPDATE, and DELETE attacks strictly blocked.');
  } finally {
    // Cleanup User A & User B test rows
    for (const table of TABLES) {
      await clientA.from(table).delete().eq('user_id', userAId);
      await clientB.from(table).delete().eq('user_id', userBId);
    }
    await clientA.auth.signOut();
    await clientB.auth.signOut();
  }

  console.log('=== ALL SUPABASE RLS & MULTI-USER ISOLATION TESTS PASSED ===');
}

runRlsAndIsolationTests().catch((err) => {
  console.error('RLS TEST FAILED:', err);
  process.exit(1);
});
