import test from 'node:test';
import assert from 'node:assert/strict';
import { createCentralVaultSession } from '../src/services/centralVaultSession.ts';

const config = {
  url: 'https://evcwoaerlykghgdevrhb.supabase.co',
  anonKey: 'sb_publishable_anon',
  workspaceKey: 'mali-vault-test-owner',
  autoSync: true,
};

const owner = {
  id: 'usr-central-block-01',
  name: 'صاحب المتجر',
  email: 'store@mali.ly',
  provider: 'email',
  createdAt: '2026-10-13T00:00:00Z',
  isLocalOnly: false,
};

const guest = {
  id: 'local-offline-guest',
  name: 'ضيف',
  email: 'guest@device.local',
  provider: 'email',
  createdAt: '2026-10-13T00:00:00Z',
  isLocalOnly: true,
};

const emptyState = u => ({
  supabaseConfig: { ...config, workspaceKey: `mali-vault-${u.id}` },
  accounts: [],
  contacts: [],
  transactions: [],
  deals: [],
  debts: [],
  procedures: [],
  budgets: [],
  marketRates: {},
  financialAudit: [],
  pendingCloudSync: false,
});

test('centralVaultSession rejects guest logins with Arabic message', async () => {
  const session = createCentralVaultSession(
    { pull: async () => ({ ok: false, success: false, message: '' }), push: async () => ({ ok: false, success: false, message: '' }) },
    emptyState
  );

  const res = await session.open(guest, config);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'session');
  assert.ok(res.message.includes('الدخول المحلي غير متاح'));
});

test('centralVaultSession blocks when remote server is offline / unavailable', async () => {
  const session = createCentralVaultSession(
    {
      pull: async () => { throw new Error('Network request failed'); },
      push: async () => { throw new Error('Network request failed'); },
    },
    emptyState
  );

  const res = await session.open(owner, config);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'unavailable');
  assert.ok(res.message.includes('تعذر الاتصال بالخادم'));
});

test('mutations in central mode require server ACK and block retries if server times out', async () => {
  let pullCount = 0;
  let pushCount = 0;

  const session = createCentralVaultSession(
    {
      pull: async () => {
        pullCount++;
        return {
          ok: true,
          success: true,
          identityVerified: true,
          isEmpty: false,
          state: emptyState(owner),
          updatedAt: '2026-10-13T10:00:00.000Z',
          snapshotUpdatedAt: '2026-10-13T10:00:00.000Z',
        };
      },
      push: async () => {
        pushCount++;
        // Simulate dropped network connection before server ACK is received
        throw new Error('Connection reset by peer');
      },
    },
    emptyState
  );

  const openRes = await session.open(owner, config);
  assert.equal(openRes.ok, true);
  assert.equal(pullCount, 1);

  // Attempting mutation during network drop
  const updateRes = await session.update(before => ({
    ...before,
    accounts: [
      { id: 'acc-1', name: 'خزينة نقدية', bankName: 'نقدي', category: 'cash', currency: 'LYD', balance: 500, isCash: true, updatedAt: '2026-10-13T10:05:00Z' },
    ],
  }));

  assert.equal(updateRes.ok, false);
  assert.equal(updateRes.reason, 'unavailable');
  assert.ok(updateRes.message.includes('تعذر تأكيد استجابة الخادم'));
  assert.equal(pushCount, 1);

  // Session must be locked; subsequent mutations cannot proceed without fresh reload
  const subsequentUpdate = await session.update(before => ({
    ...before,
    accounts: [],
  }));
  assert.equal(subsequentUpdate.ok, false);
  assert.equal(subsequentUpdate.reason, 'unavailable');
});

test('centralVaultSession enforces CAS optimistic concurrency rejection on remote conflict', async () => {
  const session = createCentralVaultSession(
    {
      pull: async () => ({
        ok: true,
        success: true,
        identityVerified: true,
        isEmpty: false,
        state: emptyState(owner),
        updatedAt: '2026-10-13T10:00:00.000Z',
      }),
      push: async () => ({
        ok: false,
        success: false,
        conflictDetected: true,
        message: 'تغيرت بيانات الحساب على الخادم.',
      }),
    },
    emptyState
  );

  await session.open(owner, config);

  const res = await session.update(before => ({
    ...before,
    contacts: [{ id: 'cnt-1', name: 'تاجر', phone: '0910000000', role: 'تاجر عملة', createdAt: '2026-10-13' }],
  }));

  assert.equal(res.ok, false);
  assert.equal(res.reason, 'conflict');
  assert.ok(res.message.includes('تغيرت بيانات الحساب على الخادم'));
});
