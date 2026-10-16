import assert from 'node:assert/strict';
import { test } from 'node:test';
import { disposableDatabase, asUser } from './database.test.mjs';

const userAdmin = '11111111-1111-4111-8111-111111111111';
const userCustomer = '22222222-2222-4222-8222-222222222222';

test('PostgreSQL 17.11 Central Admin RBAC & Maintenance Enforcement', async (t) => {
  const db = await disposableDatabase();

  try {
    // Setup: Grant admin role to userAdmin in public.mali_admin_roles
    await db.query(`
      INSERT INTO public.mali_admin_roles (user_id, role)
      VALUES ('${userAdmin}', 'owner')
    `);

    await t.test('1. mali_is_admin correctly distinguishes admin from customer', async () => {
      // userAdmin must return true
      await asUser(db, userAdmin, async () => {
        const res = await db.query('SELECT public.mali_is_admin() AS is_admin');
        assert.equal(res.rows[0].is_admin, true);
      }, true);

      // userCustomer must return false
      await asUser(db, userCustomer, async () => {
        const res = await db.query('SELECT public.mali_is_admin() AS is_admin');
        assert.equal(res.rows[0].is_admin, false);
      }, true);
    });

    await t.test('2. mali_check_admin_role RPC reports status to authenticated user', async () => {
      await asUser(db, userAdmin, async () => {
        const res = await db.query('SELECT public.mali_check_admin_role() AS status');
        assert.equal(res.rows[0].status.is_admin, true);
        assert.equal(res.rows[0].status.role, 'owner');
      }, true);

      await asUser(db, userCustomer, async () => {
        const res = await db.query('SELECT public.mali_check_admin_role() AS status');
        assert.equal(res.rows[0].status.is_admin, false);
        assert.equal(res.rows[0].status.role, null);
      }, true);
    });

    await t.test('3. mali_system_settings is publicly readable but not writable by regular customers', async () => {
      // Customer can read maintenance mode
      await asUser(db, userCustomer, async () => {
        const res = await db.query("SELECT * FROM public.mali_system_settings WHERE key = 'maintenance_mode'");
        assert.equal(res.rows.length, 1);
        assert.equal(res.rows[0].value.active, false);
      }, true);

      // Customer cannot directly update or insert into mali_system_settings
      await asUser(db, userCustomer, async () => {
        await assert.rejects(
          db.query("UPDATE public.mali_system_settings SET value = '{\"active\":true}' WHERE key = 'maintenance_mode'"),
          /42501|permission denied|violates row-level security/i
        );
      }, true);
    });

    await t.test('4. Admin toggle maintenance mode updates settings and records immutable audit log', async () => {
      // Customer trying to toggle maintenance mode via RPC is rejected
      await asUser(db, userCustomer, async () => {
        await assert.rejects(
          db.query("SELECT public.mali_admin_toggle_maintenance(true, 'تخريب غير مصرح')"),
          /غير مصرح لك بتغيير وضع الصيانة/
        );
      }, true);

      // Admin toggling maintenance mode succeeds
      await asUser(db, userAdmin, async () => {
        const res = await db.query("SELECT public.mali_admin_toggle_maintenance(true, 'ترقية قاعدة البيانات المركزية') AS result");
        assert.equal(res.rows[0].result.active, true);
        assert.equal(res.rows[0].result.reason, 'ترقية قاعدة البيانات المركزية');

        // Audit log must have recorded the event
        const auditRes = await db.query("SELECT * FROM public.mali_admin_audit_log WHERE action = 'maintenance_toggle'");
        assert.ok(auditRes.rows.length >= 1);
        assert.equal(auditRes.rows[0].actor_id, userAdmin);
        assert.equal(auditRes.rows[0].details.current.active, true);
      }, true);

      // Customer reads updated maintenance mode
      await asUser(db, userCustomer, async () => {
        const res = await db.query("SELECT * FROM public.mali_system_settings WHERE key = 'maintenance_mode'");
        assert.equal(res.rows[0].value.active, true);
        assert.equal(res.rows[0].value.reason, 'ترقية قاعدة البيانات المركزية');
      }, true);

      // Admin turns off maintenance mode
      await asUser(db, userAdmin, async () => {
        const res = await db.query("SELECT public.mali_admin_toggle_maintenance(false, NULL) AS result");
        assert.equal(res.rows[0].result.active, false);
      }, true);
    });

    await t.test('5. Database trigger blocks financial snapshot writes when maintenance mode is active', async () => {
      // Turn maintenance mode ON
      await asUser(db, userAdmin, async () => {
        await db.query("SELECT public.mali_admin_toggle_maintenance(true, 'صيانة نشطة')");
      }, true);

      // Customer attempt to write snapshot must be strictly blocked by trigger with code 55000
      await asUser(db, userCustomer, async () => {
        await assert.rejects(
          db.query(`
            INSERT INTO public.mali_vault_snapshots (workspace_key, user_id, payload, updated_at)
            VALUES ('mali-test-vault', '${userCustomer}', '{}'::jsonb, clock_timestamp())
          `),
          /نظام مالي في وضع الصيانة المركزية حالياً/
        );
      }, true);

      // Turn maintenance mode OFF
      await asUser(db, userAdmin, async () => {
        await db.query("SELECT public.mali_admin_toggle_maintenance(false, NULL)");
      }, true);

      // Customer attempt to write snapshot now succeeds
      await asUser(db, userCustomer, async () => {
        await db.query(`
          INSERT INTO public.mali_vault_snapshots (workspace_key, user_id, payload, updated_at)
          VALUES ('mali-test-vault', '${userCustomer}', '{}'::jsonb, clock_timestamp())
        `);
        const verify = await db.query(`SELECT * FROM public.mali_vault_snapshots WHERE user_id = '${userCustomer}'`);
        assert.equal(verify.rows.length, 1);
      }, true);
    });

    await t.test('6. Admin RPCs return real data and reject unauthorized customer access', async () => {
      // Metrics: Customer rejected
      await asUser(db, userCustomer, async () => {
        await assert.rejects(
          db.query('SELECT public.mali_admin_get_system_metrics()'),
          /غير مصرح لك بالوصول إلى لوحة الإدارة/
        );
      }, true);

      // Metrics: Admin succeeds with real counts
      await asUser(db, userAdmin, async () => {
        const res = await db.query('SELECT public.mali_admin_get_system_metrics() AS metrics');
        assert.ok(res.rows[0].metrics);
        assert.ok(Number(res.rows[0].metrics.registeredUsersCount) >= 2);
        assert.ok(Number(res.rows[0].metrics.activeVaultsCount) >= 1);
        assert.equal(res.rows[0].metrics.systemHealth, 'healthy');
      }, true);

      // Users: Customer rejected
      await asUser(db, userCustomer, async () => {
        await assert.rejects(
          db.query('SELECT public.mali_admin_get_users()'),
          /غير مصرح لك بالوصول إلى قائمة مستخدمي النظام/
        );
      }, true);

      // Users: Admin succeeds
      await asUser(db, userAdmin, async () => {
        const res = await db.query('SELECT public.mali_admin_get_users() AS users');
        assert.ok(Array.isArray(res.rows[0].users));
        assert.ok(res.rows[0].users.length >= 2);
      }, true);

      // Security Events: Customer rejected
      await asUser(db, userCustomer, async () => {
        await assert.rejects(
          db.query('SELECT public.mali_admin_get_security_events()'),
          /غير مصرح لك بالوصول إلى سجل أحداث الأمان/
        );
      }, true);

      // Security Events: Admin succeeds
      await asUser(db, userAdmin, async () => {
        const res = await db.query('SELECT public.mali_admin_get_security_events() AS events');
        assert.ok(Array.isArray(res.rows[0].events));
        assert.ok(res.rows[0].events.length >= 1);
      }, true);
    });
  } finally {
    await db.close();
  }
});
