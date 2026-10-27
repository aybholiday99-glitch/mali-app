import assert from 'node:assert/strict';
import { test } from 'node:test';
import { disposableDatabase, asUser } from './database.test.mjs';

const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';

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

test('PostgreSQL / Supabase Storage Receipts Isolation and Security', async (t) => {
  const db = await disposableDatabase();

  try {
    await t.test('1. mali-receipts bucket exists with strict configuration', async () => {
      const res = await db.query("SELECT * FROM storage.buckets WHERE id = 'mali-receipts'");
      assert.equal(res.rows.length, 1);
      const bucket = res.rows[0];
      assert.equal(bucket.name, 'mali-receipts');
      assert.equal(bucket.public, false, 'mali-receipts bucket MUST be private');
      assert.equal(Number(bucket.file_size_limit), 5242880, 'Max file size must be 5MB (5242880 bytes)');
      assert.deepEqual(
        bucket.allowed_mime_types,
        ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
        'Allowed MIME types must strictly match requirement'
      );
    });

    await t.test('2. User A can upload valid receipts to userA/ folder', async () => {
      // PNG receipt
      await asUser(db, userA, async () => {
        const res = await db.query(
          `INSERT INTO storage.objects (bucket_id, name, metadata)
           VALUES ('mali-receipts', $1, $2::jsonb)
           RETURNING *`,
          [`${userA}/receipt.png`, JSON.stringify({ size: 1024, mimetype: 'image/png' })]
        );
        assert.equal(res.rows.length, 1);
        assert.equal(res.rows[0].name, `${userA}/receipt.png`);
      });

      // PDF document
      await asUser(db, userA, async () => {
        const res = await db.query(
          `INSERT INTO storage.objects (bucket_id, name, metadata)
           VALUES ('mali-receipts', $1, $2::jsonb)
           RETURNING *`,
          [`${userA}/invoices/bill.pdf`, JSON.stringify({ size: 204800, mimetype: 'application/pdf' })]
        );
        assert.equal(res.rows.length, 1);
      });

      // JPEG photo
      await asUser(db, userA, async () => {
        const res = await db.query(
          `INSERT INTO storage.objects (bucket_id, name, metadata)
           VALUES ('mali-receipts', $1, $2::jsonb)
           RETURNING *`,
          [`${userA}/photo.jpeg`, JSON.stringify({ size: 500000, mimetype: 'image/jpeg' })]
        );
        assert.equal(res.rows.length, 1);
      });

      // WEBP image at exact 5MB limit
      await asUser(db, userA, async () => {
        const res = await db.query(
          `INSERT INTO storage.objects (bucket_id, name, metadata)
           VALUES ('mali-receipts', $1, $2::jsonb)
           RETURNING *`,
          [`${userA}/scan.webp`, JSON.stringify({ size: 5242880, mimetype: 'image/webp' })]
        );
        assert.equal(res.rows.length, 1);
      });

      // User A can read their own uploaded objects
      await asUser(db, userA, async () => {
        const res = await db.query("SELECT * FROM storage.objects WHERE bucket_id = 'mali-receipts'");
        assert.equal(res.rows.length, 4);
      });
    });

    await t.test('3. User B is blocked from reading, modifying, or deleting User A objects', async () => {
      // User B cannot SELECT User A's object
      await asUser(db, userB, async () => {
        const res = await db.query(
          "SELECT * FROM storage.objects WHERE name = $1",
          [`${userA}/receipt.png`]
        );
        assert.equal(res.rows.length, 0, 'User B must see 0 rows for User A files');

        // User B sees empty listing when querying the bucket
        const listRes = await db.query("SELECT * FROM storage.objects WHERE bucket_id = 'mali-receipts'");
        assert.equal(listRes.rows.length, 0, 'User B must see 0 rows in total before uploading their own');
      });

      // User B cannot UPDATE User A's object
      await asUser(db, userB, async () => {
        const updateRes = await db.query(
          "UPDATE storage.objects SET metadata = $1 WHERE name = $2 RETURNING *",
          [JSON.stringify({ size: 50, mimetype: 'image/png' }), `${userA}/receipt.png`]
        );
        assert.equal(updateRes.rows.length, 0, 'User B UPDATE on User A object must affect 0 rows');
      });

      // User B cannot DELETE User A's object
      await asUser(db, userB, async () => {
        const deleteRes = await db.query(
          "DELETE FROM storage.objects WHERE name = $1 RETURNING *",
          [`${userA}/receipt.png`]
        );
        assert.equal(deleteRes.rows.length, 0, 'User B DELETE on User A object must affect 0 rows');
      });

      // Verify User A's object is still intact
      await asUser(db, userA, async () => {
        const checkRes = await db.query(
          "SELECT * FROM storage.objects WHERE name = $1",
          [`${userA}/receipt.png`]
        );
        assert.equal(checkRes.rows.length, 1, 'User A object must remain intact');
      });
    });

    await t.test('4. Cross-user upload injection into another user folder is rejected', async () => {
      // User B tries to insert an object directly into User A's folder
      await asUser(db, userB, async () => {
        await assert.rejects(
          db.query(
            `INSERT INTO storage.objects (bucket_id, name, metadata)
             VALUES ('mali-receipts', $1, $2::jsonb)`,
            [`${userA}/spoofed.png`, JSON.stringify({ size: 100, mimetype: 'image/png' })]
          ),
          /row-level security/i
        );
      });
    });

    await t.test('5. Uploads lacking user folder prefix are rejected', async () => {
      // Root-level file without user folder prefix
      await asUser(db, userA, async () => {
        await assert.rejects(
          db.query(
            `INSERT INTO storage.objects (bucket_id, name, metadata)
             VALUES ('mali-receipts', 'root_receipt.png', $1::jsonb)`,
            [JSON.stringify({ size: 100, mimetype: 'image/png' })]
          ),
          /row-level security/i
        );
      });
    });

    await t.test('6. Uploads exceeding 5MB (5242880 bytes) are rejected', async () => {
      // 5242881 bytes (5MB + 1 byte)
      await asUser(db, userA, async () => {
        await assert.rejects(
          db.query(
            `INSERT INTO storage.objects (bucket_id, name, metadata)
             VALUES ('mali-receipts', $1, $2::jsonb)`,
            [`${userA}/oversize.png`, JSON.stringify({ size: 5242881, mimetype: 'image/png' })]
          ),
          /row-level security/i
        );
      });

      // 10MB file
      await asUser(db, userA, async () => {
        await assert.rejects(
          db.query(
            `INSERT INTO storage.objects (bucket_id, name, metadata)
             VALUES ('mali-receipts', $1, $2::jsonb)`,
            [`${userA}/large_scan.pdf`, JSON.stringify({ size: 10485760, mimetype: 'application/pdf' })]
          ),
          /row-level security/i
        );
      });
    });

    await t.test('7. Disallowed MIME types are rejected', async () => {
      const disallowed = [
        'text/html',
        'application/javascript',
        'application/x-sh',
        'image/gif',
        'image/svg+xml',
        'application/octet-stream',
        'text/plain',
      ];

      for (const mime of disallowed) {
        await asUser(db, userA, async () => {
          await assert.rejects(
            db.query(
              `INSERT INTO storage.objects (bucket_id, name, metadata)
               VALUES ('mali-receipts', $1, $2::jsonb)`,
              [`${userA}/bad_file_${mime.replace(/[^a-z]/g, '')}`, JSON.stringify({ size: 100, mimetype: mime })]
            ),
            /row-level security/i,
            `MIME type ${mime} must be rejected`
          );
        });
      }
    });

    await t.test('8. Anonymous users (anon) are completely blocked from storage', async () => {
      // Check privilege table directly
      const privObjects = await db.query(
        "SELECT has_table_privilege('anon', 'storage.objects', 'select,insert,update,delete') AS allowed"
      );
      assert.equal(privObjects.rows[0].allowed, false, 'anon must not have any privilege on storage.objects');

      const privBuckets = await db.query(
        "SELECT has_table_privilege('anon', 'storage.buckets', 'select,insert,update,delete') AS allowed"
      );
      assert.equal(privBuckets.rows[0].allowed, false, 'anon must not have any privilege on storage.buckets');

      // Attempt SELECT as anon
      await asAnon(db, async () => {
        await assert.rejects(
          db.query("SELECT * FROM storage.objects"),
          /42501|permission denied/i
        );
      });

      // Attempt INSERT as anon
      await asAnon(db, async () => {
        await assert.rejects(
          db.query(
            `INSERT INTO storage.objects (bucket_id, name, metadata)
             VALUES ('mali-receipts', 'anon/exploit.png', '{"size":100,"mimetype":"image/png"}'::jsonb)`
          ),
          /42501|permission denied/i
        );
      });

      // Attempt SELECT on storage.buckets as anon
      await asAnon(db, async () => {
        await assert.rejects(
          db.query("SELECT * FROM storage.buckets"),
          /42501|permission denied/i
        );
      });
    });

    await t.test('9. User A can update and delete their own files', async () => {
      // User A updates metadata of their own file
      await asUser(db, userA, async () => {
        const updateRes = await db.query(
          `UPDATE storage.objects
           SET metadata = $1::jsonb
           WHERE name = $2
           RETURNING *`,
          [JSON.stringify({ size: 2048, mimetype: 'image/png' }), `${userA}/receipt.png`]
        );
        assert.equal(updateRes.rows.length, 1);
        assert.equal(updateRes.rows[0].metadata.size, 2048);
      });

      // User A deletes their own file
      await asUser(db, userA, async () => {
        const delRes = await db.query(
          "DELETE FROM storage.objects WHERE name = $1 RETURNING *",
          [`${userA}/receipt.png`]
        );
        assert.equal(delRes.rows.length, 1);

        // Verify it is gone
        const selRes = await db.query(
          "SELECT * FROM storage.objects WHERE name = $1",
          [`${userA}/receipt.png`]
        );
        assert.equal(selRes.rows.length, 0);
      });
    });
  } finally {
    await db.close();
  }
});
