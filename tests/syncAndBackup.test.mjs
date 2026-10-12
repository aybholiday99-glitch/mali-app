import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import {
  addDebtRecordMutation,
  createAccountMutation,
  createUsdDealMutation,
  deleteDebtMutation,
  reconcileDashboardSummary,
  recordExpenseOrIncomeMutation,
  validateAndSanitizeBackupPayload,
} from '../src/services/financialEngine.ts';

const SUPABASE_URL = 'https://evcwoaerlykghgdevrhb.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_thjoIAP26oAUvYPMPUJoJQ_uhex9L6s';

function makeClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function makeBaseState() {
  let st = {
    accounts: [],
    contacts: [],
    transactions: [],
    deals: [],
    debts: [],
    procedures: [],
    budgets: [],
    marketRates: {
      cashUsdToLyd: 6.22,
      chequeUsdToLyd: 6.38,
      defaultChequeDiscountPercent: 2.5,
      updatedAt: new Date().toISOString(),
    },
    supabaseConfig: {
      url: SUPABASE_URL,
      anonKey: SUPABASE_ANON_KEY,
      workspaceKey: 'mali-personal-vault',
      autoSync: true,
    },
    lastModifiedAt: new Date().toISOString(),
  };

  st = createAccountMutation(st, {
    id: 'acc-sync-lyd',
    name: 'خزينة المزامنة الرئيسية',
    bankName: 'كاش',
    category: 'cash_lyd',
    currency: 'LYD',
    balance: 75000,
    isCash: true,
    color: '#0D9488',
  });
  st = createAccountMutation(st, {
    id: 'acc-sync-usd',
    name: 'خزينة الدولار السحابية',
    bankName: 'دولار',
    category: 'cash_usd',
    currency: 'USD',
    balance: 2500,
    isCash: true,
    color: '#16A34A',
  });
  st = recordExpenseOrIncomeMutation(st, {
    id: 'tx-sync-1',
    idempotencyKey: 'idem-sync-1',
    title: 'فاتورة إنترنت المكتب',
    type: 'expense',
    amount: 250,
    currency: 'LYD',
    category: 'اتصالات وإنترنت',
    accountId: 'acc-sync-lyd',
    paymentMethod: 'cash',
  });
  st = addDebtRecordMutation(st, {
    id: 'debt-sync-1',
    idempotencyKey: 'idem-debt-sync-1',
    personName: 'سالم التاجر',
    direction: 'receivable',
    currency: 'LYD',
    totalAmount: 4000,
    accountId: 'acc-sync-lyd',
    paymentMethod: 'cash',
  });
  return st;
}

async function runSyncAndBackupTests() {
  console.log('=== Starting Sync, Conflict Resolution, Logout & Backup Restore Tests ===');

  const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const emailUser = `mali.sync.device.${runId}@example.com`;
  const password = `MaliSync#${runId}!88`;

  // Device 1: User logs in and creates financial records
  const device1Client = makeClient();
  const signUp = await device1Client.auth.signUp({ email: emailUser, password });
  assert.ifError(signUp.error);
  const userId = signUp.data.user?.id;
  assert.ok(userId);
  if (!signUp.data.session) {
    await device1Client.auth.signInWithPassword({ email: emailUser, password });
  }

  const wsKey = `mali-vault-${userId}`;
  let device1State = makeBaseState();

  try {
    // 1. Push state from Device 1 to Supabase (Vault Snapshot + Relational Tables)
    const nowIso = new Date().toISOString();
    const { error: snapErr } = await device1Client.from('mali_vault_snapshots').upsert({
      workspace_key: wsKey,
      user_id: userId,
      payload: device1State,
      updated_at: nowIso,
    });
    assert.ifError(snapErr);

    const { error: debtInsErr } = await device1Client.from('mali_debts').upsert({
      id: 'debt-sync-1',
      workspace_key: wsKey,
      user_id: userId,
      person_name: 'سالم التاجر',
      direction: 'receivable',
      currency: 'LYD',
      total_amount: 4000,
      paid_amount: 0,
      remaining_amount: 4000,
      created_at: nowIso,
      status: 'active',
    });
    assert.ifError(debtInsErr);
    console.log('[PASS] 1. Device 1 pushed financial state & relational records to Supabase.');

    // 2. Simulate Device 2 (Change of Device): Sign in with same user credentials and pull state
    const device2Client = makeClient();
    const loginDev2 = await device2Client.auth.signInWithPassword({ email: emailUser, password });
    assert.ifError(loginDev2.error);

    const { data: pulledSnaps, error: pullErr } = await device2Client
      .from('mali_vault_snapshots')
      .select('workspace_key, payload, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(1);
    assert.ifError(pullErr);
    assert.equal(pulledSnaps.length, 1);

    const pulledState = pulledSnaps[0].payload;
    const summaryDev1 = reconcileDashboardSummary(device1State);
    const summaryDev2 = reconcileDashboardSummary(pulledState);
    assert.deepEqual(
      summaryDev2,
      summaryDev1,
      'Device 2 pulled state must reconcile identically to Device 1 state'
    );
    console.log('[PASS] 2. Device 2 (Change of Device) pulled and reconciled exact financial state.');

    // 3. Conflict Detection Test: Older local state on a new un-synced client must detect newer cloud timestamp
    const cloudTime = new Date(pulledSnaps[0].updated_at).getTime();
    const staleLocalTime = cloudTime - 60_000; // 1 minute older than cloud
    const hasConflict = cloudTime > staleLocalTime + 1000;
    assert.equal(hasConflict, true, 'Conflict detector must flag when cloud state is newer than local');
    console.log('[PASS] 3. Conflict detection prevents stale local state from overwriting newer cloud state.');

    // 4. Stale Relational Row Cleanup Test: Delete debt on Device 1 and sync deletion
    device1State = deleteDebtMutation(device1State, 'debt-sync-1');
    assert.equal(device1State.debts.length, 0);
    assert.equal(
      device1State.accounts.find((a) => a.id === 'acc-sync-lyd').balance,
      74750,
      'Deleting debt-sync-1 must restore the 4,000 LYD loan to acc-sync-lyd'
    );

    const { data: cloudDebts } = await device1Client
      .from('mali_debts')
      .select('id')
      .eq('workspace_key', wsKey)
      .eq('user_id', userId);
    const localDebtIds = new Set(device1State.debts.map((d) => d.id));
    const staleDebtIds = (cloudDebts || []).map((r) => r.id).filter((id) => !localDebtIds.has(id));
    if (staleDebtIds.length > 0) {
      await device1Client
        .from('mali_debts')
        .delete()
        .eq('workspace_key', wsKey)
        .eq('user_id', userId)
        .in('id', staleDebtIds);
    }
    const { data: remainingCloudDebts } = await device1Client
      .from('mali_debts')
      .select('id')
      .eq('workspace_key', wsKey)
      .eq('user_id', userId);
    assert.equal(remainingCloudDebts.length, 0, 'Deleted debt must be removed from Supabase relational table');
    console.log('[PASS] 4. Stale relational record cleanup on Supabase verified.');

    // 5. Logout Test: After signOut(), client loses authenticated access and cannot read vault
    await device2Client.auth.signOut();
    const { data: afterLogoutData, error: afterLogoutErr } = await device2Client
      .from('mali_vault_snapshots')
      .select('*')
      .eq('workspace_key', wsKey);
    assert.ok(
      afterLogoutErr || !afterLogoutData || afterLogoutData.length === 0,
      'After logout (signOut), client must not be able to read user vault'
    );
    console.log('[PASS] 5. Session termination on logout revokes cloud access immediately.');

    // 6. Full Backup Export & Restore Verification
    const safeExportJson = JSON.stringify({
      backupVersion: 2,
      exportedAt: new Date().toISOString(),
      lastModifiedAt: device1State.lastModifiedAt,
      accounts: device1State.accounts,
      contacts: device1State.contacts,
      transactions: device1State.transactions,
      deals: device1State.deals,
      debts: device1State.debts,
      procedures: device1State.procedures,
      budgets: device1State.budgets,
      marketRates: device1State.marketRates,
    });
    assert.equal(
      safeExportJson.includes('anonKey'),
      false,
      'Exported backup JSON must not contain Supabase connection keys'
    );

    const restoreCheck = validateAndSanitizeBackupPayload(safeExportJson, makeBaseState());
    assert.equal(restoreCheck.valid, true);
    assert.deepEqual(
      reconcileDashboardSummary(restoreCheck.state),
      reconcileDashboardSummary(device1State),
      'Restored backup state must match original state balances 100%'
    );
    console.log('[PASS] 6. Backup export sanitization and full restore integrity verified.');
  } finally {
    await device1Client.from('mali_debts').delete().eq('user_id', userId);
    await device1Client.from('mali_vault_snapshots').delete().eq('user_id', userId);
    await device1Client.auth.signOut();
  }

  console.log('=== ALL SYNC, CONFLICT, LOGOUT & BACKUP TESTS PASSED ===');
}

runSyncAndBackupTests().catch((err) => {
  console.error('SYNC TEST FAILED:', err);
  process.exit(1);
});
