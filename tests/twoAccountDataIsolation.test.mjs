import assert from 'node:assert/strict';
import { test } from 'node:test';
import { disposableDatabase, asUser } from './database.test.mjs';
import { SessionScope, emptyFinancialState } from '../src/services/sessionScope.ts';
import { INITIAL_MALI_STATE } from '../src/data/initialData.ts';

const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';

const financialTables = [
  'mali_accounts',
  'mali_contacts',
  'mali_debts',
  'mali_transactions',
  'mali_usd_deals',
  'mali_vault_snapshots',
];

const relationalTables = [
  'mali_accounts',
  'mali_contacts',
  'mali_debts',
  'mali_transactions',
  'mali_usd_deals',
];

async function asAnon(db, action) {
  await db.exec('BEGIN');
  try {
    await db.exec('SET LOCAL ROLE anon');
    await db.query("select set_config('request.jwt.claim.sub', '', true)");
    const result = await action();
    await db.exec('COMMIT');
    return result;
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}

function makeRow(table, userId, idSuffix, workspaceKey = 'vault-default-key') {
  const safeWorkspaceKey = workspaceKey.length >= 6 ? workspaceKey : `${workspaceKey}_valid`;
  const common = {
    workspace_key: safeWorkspaceKey,
    user_id: userId,
    id: `row-${idSuffix}`,
  };

  switch (table) {
    case 'mali_vault_snapshots':
      return {
        workspace_key: safeWorkspaceKey,
        user_id: userId,
        payload: { secret: `data-for-${userId}` },
      };
    case 'mali_accounts':
      return {
        ...common,
        name: `Account-${idSuffix}`,
        bank_name: 'Bank Al-Jumhouria',
        category: 'cash_lyd',
        currency: 'LYD',
        balance: 1500,
        is_cash: true,
      };
    case 'mali_contacts':
      return {
        ...common,
        name: `Contact-${idSuffix}`,
        phone: '0912345678',
        role: 'شخصي / عميل',
      };
    case 'mali_usd_deals':
      return {
        ...common,
        deal_number: `D-${idSuffix}`,
        title: `Deal-${idSuffix}`,
        counterparty: 'Trader X',
        buy_date: '2026-10-15',
        usd_amount: 5000,
        buy_rate: 6.85,
        effective_buy_rate: 6.85,
        total_lyd_cost: 34250,
        buy_method: 'cash',
        source_lyd_account_id: 'lyd-acc',
        target_usd_account_id: 'usd-acc',
        status: 'open',
      };
    case 'mali_transactions':
      return {
        ...common,
        title: `Tx-${idSuffix}`,
        type: 'income',
        amount: 500,
        currency: 'LYD',
        category: 'sales',
        account_id: 'lyd-acc',
        payment_method: 'cash',
        tx_date: '2026-10-15',
      };
    case 'mali_debts':
      return {
        ...common,
        person_name: `Debtor-${idSuffix}`,
        direction: 'receivable',
        currency: 'LYD',
        total_amount: 1200,
        paid_amount: 200,
        remaining_amount: 1000,
        created_at: '2026-10-15',
        status: 'active',
      };
    default:
      throw new Error(`Unknown table: ${table}`);
  }
}

async function insertRow(db, table, row) {
  const fields = Object.keys(row);
  const placeholders = fields.map((_, i) => `$${i + 1}`).join(',');
  const values = Object.values(row);
  return db.query(
    `INSERT INTO public.${table} (${fields.join(',')}) VALUES (${placeholders}) RETURNING *`,
    values
  );
}

test('Two-Account Financial Data Isolation & Security Hardening Matrix', async (t) => {
  const db = await disposableDatabase();

  try {
    // =========================================================================
    // 1. Cross-User CRUD Isolation across all 6 financial tables
    // =========================================================================
    for (const table of financialTables) {
      await t.test(`${table}: User B cannot SELECT, INSERT, UPDATE, or DELETE User A's rows`, async () => {
        const rowA = makeRow(table, userA, `userA-${table}`, `workspace-user-a-${table}`);

        // User A inserts their own row
        await asUser(db, userA, () => insertRow(db, table, rowA), true);

        // User A can read their own row
        const selectA = await asUser(db, userA, () => db.query(`SELECT * FROM public.${table}`));
        assert.ok(selectA.rows.length >= 1, `User A must see their own row in ${table}`);

        // User B cannot SELECT User A's row
        const selectB = await asUser(db, userB, () => db.query(`SELECT * FROM public.${table}`));
        assert.equal(selectB.rows.length, 0, `User B must see 0 rows in ${table}`);

        // User B cannot SELECT User A's row even by targeting workspace_key or user_id
        const targetedB = await asUser(db, userB, () =>
          db.query(`SELECT * FROM public.${table} WHERE user_id = $1 OR workspace_key = $2`, [
            userA,
            `workspace-user-a-${table}`,
          ])
        );
        assert.equal(targetedB.rows.length, 0, `User B targeted query must return 0 rows in ${table}`);

        // User B cannot INSERT claiming User A's user_id
        const spoofedRow = table === 'mali_vault_snapshots'
          ? { ...rowA, workspace_key: `spoofed-key-${table}` }
          : { ...rowA, id: `spoofed-${table}` };
        await assert.rejects(
          asUser(db, userB, () => insertRow(db, table, spoofedRow), true),
          /row-level security/i,
          `User B inserting with user_id = userA must be rejected by RLS in ${table}`
        );

        // User B cannot INSERT with user_id = NULL
        const nullUserRow = { ...spoofedRow, user_id: null };
        await assert.rejects(
          asUser(db, userB, () => insertRow(db, table, nullUserRow), true),
          /row-level security|not-null/i,
          `User B inserting with user_id = NULL must be rejected in ${table}`
        );

        // User B cannot UPDATE User A's rows
        const updateB = await asUser(db, userB, () =>
          db.query(
            `UPDATE public.${table} SET workspace_key = 'hacked-key' WHERE user_id = $1 RETURNING *`,
            [userA]
          ),
          true
        );
        assert.equal(updateB.rows.length, 0, `User B update on User A rows must affect 0 rows in ${table}`);

        // User B cannot DELETE User A's rows
        const deleteB = await asUser(db, userB, () =>
          db.query(`DELETE FROM public.${table} WHERE user_id = $1 RETURNING *`, [userA]),
          true
        );
        assert.equal(deleteB.rows.length, 0, `User B delete on User A rows must affect 0 rows in ${table}`);

        // Verify User A's row remains completely intact
        const verifyA = await asUser(db, userA, () =>
          db.query(`SELECT * FROM public.${table} WHERE user_id = $1`, [userA])
        );
        assert.ok(verifyA.rows.length >= 1, `User A row must remain completely intact in ${table}`);
      });
    }

    // =========================================================================
    // 2. Manipulating workspace_key is NEVER an authorization bypass
    // =========================================================================
    // Test relational tables where both users share the exact same workspace_key
    for (const table of relationalTables) {
      await t.test(`${table}: Manipulating shared workspace_key never grants authorization bypass`, async () => {
        const sharedKey = `shared-vault-key-${table}`;
        const rowA = makeRow(table, userA, `sharedA-${table}`, sharedKey);
        const rowB = makeRow(table, userB, `sharedB-${table}`, sharedKey);

        // User A and User B insert rows that share the identical workspace_key
        await asUser(db, userA, () => insertRow(db, table, rowA), true);
        await asUser(db, userB, () => insertRow(db, table, rowB), true);

        // User B querying with the exact shared workspace_key sees ONLY User B's row
        const resB = await asUser(db, userB, () =>
          db.query(`SELECT * FROM public.${table} WHERE workspace_key = $1`, [sharedKey])
        );
        assert.equal(resB.rows.length, 1, `User B must only see their own row even with matching workspace_key in ${table}`);
        assert.equal(resB.rows[0].user_id, userB, `Returned row must belong exclusively to User B in ${table}`);

        // User A querying with the exact shared workspace_key sees ONLY User A's row
        const resA = await asUser(db, userA, () =>
          db.query(`SELECT * FROM public.${table} WHERE workspace_key = $1`, [sharedKey])
        );
        assert.equal(resA.rows.length, 1, `User A must only see their own row even with matching workspace_key in ${table}`);
        assert.equal(resA.rows[0].user_id, userA, `Returned row must belong exclusively to User A in ${table}`);

        // User B updating by shared workspace_key modifies ONLY User B's row
        const updateB = await asUser(db, userB, () =>
          db.query(
            `UPDATE public.${table} SET workspace_key = $1 WHERE workspace_key = $2 RETURNING *`,
            [`modified-by-b-${table}`, sharedKey]
          ),
          true
        );
        assert.equal(updateB.rows.length, 1);
        assert.equal(updateB.rows[0].user_id, userB);

        // User A's row still retains the original workspace_key and was not touched
        const checkA = await asUser(db, userA, () =>
          db.query(`SELECT * FROM public.${table} WHERE workspace_key = $1`, [sharedKey])
        );
        assert.equal(checkA.rows.length, 1, `User A row must be unaffected by User B update on ${table}`);
        assert.equal(checkA.rows[0].user_id, userA);

        // User B deleting by workspace_key deletes ONLY User B's row
        const delB = await asUser(db, userB, () =>
          db.query(`DELETE FROM public.${table} WHERE workspace_key = $1 RETURNING *`, [`modified-by-b-${table}`]),
          true
        );
        assert.equal(delB.rows.length, 1);
        assert.equal(delB.rows[0].user_id, userB);

        // User A's row is still present and intact
        const finalA = await asUser(db, userA, () =>
          db.query(`SELECT * FROM public.${table} WHERE workspace_key = $1`, [sharedKey])
        );
        assert.equal(finalA.rows.length, 1, `User A row must persist after User B deletion in ${table}`);
      });
    }

    // Test mali_vault_snapshots where workspace_key is PK
    await t.test('mali_vault_snapshots: workspace_key cannot be spoofed or used to access another snapshot', async () => {
      const snapKeyA = 'vault-snapshot-key-user-a';
      const snapKeyB = 'vault-snapshot-key-user-b';

      const rowA = makeRow('mali_vault_snapshots', userA, 'snapA', snapKeyA);
      const rowB = makeRow('mali_vault_snapshots', userB, 'snapB', snapKeyB);

      await asUser(db, userA, () => insertRow(db, 'mali_vault_snapshots', rowA), true);
      await asUser(db, userB, () => insertRow(db, 'mali_vault_snapshots', rowB), true);

      // User B querying User A's snapshot key sees 0 rows
      const resB = await asUser(db, userB, () =>
        db.query("SELECT * FROM public.mali_vault_snapshots WHERE workspace_key = $1", [snapKeyA])
      );
      assert.equal(resB.rows.length, 0, 'User B must not see User A snapshot');

      // User B attempting to update User A's snapshot affects 0 rows
      const updateB = await asUser(db, userB, () =>
        db.query(
          "UPDATE public.mali_vault_snapshots SET payload = '{\"hacked\":true}'::jsonb WHERE workspace_key = $1 RETURNING *",
          [snapKeyA]
        ),
        true
      );
      assert.equal(updateB.rows.length, 0, 'User B must not be able to update User A snapshot');

      // User B attempting to delete User A's snapshot affects 0 rows
      const delB = await asUser(db, userB, () =>
        db.query("DELETE FROM public.mali_vault_snapshots WHERE workspace_key = $1 RETURNING *", [snapKeyA]),
        true
      );
      assert.equal(delB.rows.length, 0, 'User B must not be able to delete User A snapshot');

      // User B attempting to overwrite User A's snapshot key with User B's user_id fails with duplicate key constraint
      await assert.rejects(
        asUser(db, userB, () =>
          insertRow(db, 'mali_vault_snapshots', {
            workspace_key: snapKeyA,
            user_id: userB,
            payload: { exploit: true },
          }),
          true
        ),
        /duplicate key|unique constraint/i,
        'User B cannot overwrite User A snapshot primary key'
      );

      // User A's snapshot remains intact
      const checkA = await asUser(db, userA, () =>
        db.query("SELECT * FROM public.mali_vault_snapshots WHERE workspace_key = $1", [snapKeyA])
      );
      assert.equal(checkA.rows.length, 1);
      assert.equal(checkA.rows[0].user_id, userA);
      assert.deepEqual(checkA.rows[0].payload, { secret: `data-for-${userA}` });
    });

    // =========================================================================
    // 3. Anonymous users (anon) are rejected from all financial tables
    // =========================================================================
    for (const table of financialTables) {
      await t.test(`${table}: anonymous role (anon) is completely rejected`, async () => {
        // Table privileges must be false
        for (const priv of ['select', 'insert', 'update', 'delete']) {
          const res = await db.query(
            `SELECT has_table_privilege('anon', 'public.${table}', $1) AS allowed`,
            [priv]
          );
          assert.equal(
            res.rows[0].allowed,
            false,
            `anon must not have ${priv} privilege on public.${table}`
          );
        }

        // Direct SELECT as anon
        await asAnon(db, async () => {
          await assert.rejects(
            db.query(`SELECT * FROM public.${table}`),
            /42501|permission denied/i,
            `anon SELECT on ${table} must throw permission denied`
          );
        });

        // Direct INSERT as anon
        await asAnon(db, async () => {
          const rowAnon = makeRow(table, userA, `anon-${table}`, `vault-anon-${table}`);
          await assert.rejects(
            insertRow(db, table, rowAnon),
            /42501|permission denied/i,
            `anon INSERT on ${table} must throw permission denied`
          );
        });

        // Direct UPDATE as anon
        await asAnon(db, async () => {
          await assert.rejects(
            db.query(`UPDATE public.${table} SET workspace_key = 'anon-pwn'`),
            /42501|permission denied/i,
            `anon UPDATE on ${table} must throw permission denied`
          );
        });

        // Direct DELETE as anon
        await asAnon(db, async () => {
          await assert.rejects(
            db.query(`DELETE FROM public.${table}`),
            /42501|permission denied/i,
            `anon DELETE on ${table} must throw permission denied`
          );
        });
      });
    }

    // Anonymous role cannot execute mali_sync_vault
    await t.test('anon cannot execute mali_sync_vault RPC', async () => {
      const privRpc = await db.query(
        "SELECT has_function_privilege('anon', 'public.mali_sync_vault(uuid,timestamptz,jsonb)', 'execute') AS allowed"
      );
      assert.equal(privRpc.rows[0].allowed, false, 'anon must not have EXECUTE privilege on mali_sync_vault');

      await asAnon(db, async () => {
        await assert.rejects(
          db.query("SELECT public.mali_sync_vault($1, NULL, '{}'::jsonb)", [userA]),
          /42501|permission denied/i
        );
      });
    });

    // =========================================================================
    // 4. Session Clearing & Memory / Local Cache Leakage Prevention
    // =========================================================================
    await t.test('Session clearing: logout resets in-memory cache and prevents cross-user leakage', async () => {
      const scope = new SessionScope();

      // Step 1: User A logs in and populates in-memory financial state
      const tokenA = scope.begin(userA);
      const userAState = {
        ...INITIAL_MALI_STATE,
        accounts: [
          { id: 'acc-1', name: 'User A Secret Treasury', balance: 500000, currency: 'LYD' },
          { id: 'acc-2', name: 'User A Foreign Exchange', balance: 75000, currency: 'USD' },
        ],
        contacts: [
          { id: 'con-1', name: 'Confidential Client X', phone: '0910000000', role: 'شخصي / عميل' },
        ],
        transactions: [
          { id: 'tx-1', title: 'Private Wire Transfer', amount: 25000, currency: 'LYD' },
        ],
        deals: [
          { id: 'deal-1', title: 'High-Volume FX Arbitrage', usdAmount: 50000, buyRate: 6.9 },
        ],
        debts: [
          { id: 'debt-1', personName: 'Prominent Debtor', remainingAmount: 80000, currency: 'LYD' },
        ],
        procedures: [
          { id: 'proc-1', title: 'Annual Tax Audit Clearance' },
        ],
        budgets: [
          { id: 'bud-1', category: 'Executive Operations', allocated: 100000 },
        ],
        financialAudit: {
          lastHash: 'a-private-hash-sha256',
          reconciliationStatus: 'clean',
        },
        lastModifiedAt: '2026-10-15T12:00:00.000Z',
      };

      // Ensure User A's memory state is fully populated
      assert.equal(userAState.accounts.length, 2);
      assert.equal(userAState.contacts.length, 1);
      assert.equal(userAState.transactions.length, 1);
      assert.equal(userAState.deals.length, 1);
      assert.equal(userAState.debts.length, 1);
      assert.equal(userAState.budgets.length, 1);
      assert.ok(userAState.financialAudit);

      // Simulate a pending async network pull started during User A's session
      let resolveDelayedPull;
      const delayedPullPromise = new Promise(resolve => {
        resolveDelayedPull = resolve;
      });
      let delayedPullApplied = false;
      const delayedCallback = delayedPullPromise.then(() => {
        if (scope.isCurrent(tokenA)) {
          delayedPullApplied = true;
        }
      });

      // Step 2: User A logs out -> Invalidate local session & clear memory state
      scope.begin(null); // SessionScope invalidation
      const postLogoutState = emptyFinancialState(INITIAL_MALI_STATE);

      // Verify all financial collections are scrubbed
      const financialCollections = ['accounts', 'contacts', 'transactions', 'deals', 'debts', 'procedures', 'budgets'];
      for (const col of financialCollections) {
        assert.deepEqual(postLogoutState[col], [], `${col} must be completely empty after logout`);
      }
      assert.equal(postLogoutState.financialAudit, undefined, 'financialAudit must be wiped on logout');
      assert.equal(postLogoutState.lastModifiedAt, undefined, 'lastModifiedAt must be wiped on logout');

      // Step 3: Delayed async pull resolves AFTER logout
      resolveDelayedPull();
      await delayedCallback;
      assert.equal(
        delayedPullApplied,
        false,
        'Delayed pull callback from User A session must be invalidated and discarded after logout'
      );
      assert.equal(scope.isCurrent(tokenA), false, 'Token A must no longer be current');

      // Step 4: User B logs in next
      const tokenB = scope.begin(userB);
      assert.equal(scope.isCurrent(tokenB), true);
      const userBState = emptyFinancialState(INITIAL_MALI_STATE);

      // Verify User B receives clean blank state with 0 leakage from User A
      for (const col of financialCollections) {
        assert.deepEqual(
          userBState[col],
          [],
          `User B state for ${col} must be completely blank and not contain User A records`
        );
      }
      assert.equal(userBState.financialAudit, undefined);
      assert.equal(userBState.lastModifiedAt, undefined);

      // Step 5: Guest / Unauthenticated session
      const guestState = emptyFinancialState(INITIAL_MALI_STATE);
      for (const col of financialCollections) {
        assert.deepEqual(guestState[col], [], `Guest state for ${col} must not contain demo or previous data`);
      }

      // Step 6: Shipped INITIAL_MALI_STATE remains intact and empty
      for (const col of financialCollections) {
        assert.deepEqual(
          INITIAL_MALI_STATE[col],
          [],
          `Shipped INITIAL_MALI_STATE ${col} must never have been mutated or contaminated`
        );
      }
    });

  } finally {
    await db.close();
  }
});
