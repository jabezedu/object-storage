const express = require('express');
const cors = require('cors');
require('dotenv').config();

const db = require('./db');
const { seedAdminUser, login, authMiddleware } = require('./auth');

const app = express();
const PORT = process.env.PORT || 4001;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3001';

app.use(cors({
  origin: CORS_ORIGIN,
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/auth/login', login);

// All other /api routes require auth
app.use('/api', authMiddleware);

// Helper to calculate costs
function calculateCost(standardBytes, infrequentBytes) {
  const standardGB = Number(standardBytes || 0) / 1073741824;
  const infrequentGB = Number(infrequentBytes || 0) / 1073741824;
  const cost = (standardGB * 0.023) + (infrequentGB * 0.0125);
  return Number(cost.toFixed(6));
}

// List all buckets with metadata & cost
app.get('/api/buckets', async (req, res) => {
  try {
    const queryText = `
      SELECT 
        b.id,
        b.name,
        b.created_at,
        COUNT(o.id)::int AS object_count,
        COALESCE(SUM(o.size_bytes), 0)::bigint AS total_size,
        COALESCE(SUM(CASE WHEN o.storage_class = 'Standard' THEN o.size_bytes ELSE 0 END), 0)::bigint AS standard_size,
        COALESCE(SUM(CASE WHEN o.storage_class = 'Infrequent' THEN o.size_bytes ELSE 0 END), 0)::bigint AS infrequent_size
      FROM buckets b
      LEFT JOIN objects o ON b.id = o.bucket_id
      GROUP BY b.id, b.name, b.created_at
      ORDER BY b.created_at DESC
    `;
    const result = await db.query(queryText);
    const buckets = result.rows.map(bucket => ({
      id: bucket.id,
      name: bucket.name,
      created_at: bucket.created_at,
      object_count: bucket.object_count,
      total_size: Number(bucket.total_size),
      estimated_monthly_cost: calculateCost(bucket.standard_size, bucket.infrequent_size)
    }));
    res.json(buckets);
  } catch (err) {
    console.error('List buckets error:', err);
    res.status(500).json({ error: 'Failed to retrieve buckets' });
  }
});

// Create bucket
app.post('/api/buckets', async (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Bucket name is required' });
  }

  // 3-30 chars, lowercase alphanumeric and hyphens
  const regex = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;
  if (!regex.test(name)) {
    return res.status(400).json({
      error: 'Bucket name must be 3-30 lowercase characters, numbers or hyphens, and cannot start or end with a hyphen'
    });
  }

  try {
    const existing = await db.query('SELECT id FROM buckets WHERE name = $1', [name]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Bucket with this name already exists' });
    }

    const insertResult = await db.query(
      'INSERT INTO buckets (user_id, name) VALUES ($1, $2) RETURNING id, name, created_at',
      [req.user.userId, name]
    );

    res.status(201).json({
      ...insertResult.rows[0],
      object_count: 0,
      total_size: 0,
      estimated_monthly_cost: 0
    });
  } catch (err) {
    console.error('Create bucket error:', err);
    res.status(500).json({ error: 'Failed to create bucket' });
  }
});

// Delete bucket
app.delete('/api/buckets/:id', async (req, res) => {
  const { id } = req.params;
  const force = req.query.force === 'true';

  try {
    const bucketResult = await db.query('SELECT * FROM buckets WHERE id = $1', [id]);
    if (bucketResult.rows.length === 0) {
      return res.status(404).json({ error: 'Bucket not found' });
    }

    const countResult = await db.query('SELECT COUNT(*)::int as count FROM objects WHERE bucket_id = $1', [id]);
    const objectCount = countResult.rows[0].count;

    if (objectCount > 0 && !force) {
      return res.status(400).json({
        error: 'Bucket is not empty',
        requiresConfirmation: true,
        objectCount
      });
    }

    await db.query('DELETE FROM buckets WHERE id = $1', [id]);
    res.json({ message: 'Bucket deleted successfully' });
  } catch (err) {
    console.error('Delete bucket error:', err);
    res.status(500).json({ error: 'Failed to delete bucket' });
  }
});

// List objects in a bucket
app.get('/api/buckets/:id/objects', async (req, res) => {
  const { id } = req.params;
  try {
    const bucket = await db.query('SELECT id, name FROM buckets WHERE id = $1', [id]);
    if (bucket.rows.length === 0) {
      return res.status(404).json({ error: 'Bucket not found' });
    }

    const objects = await db.query(
      `SELECT id, bucket_id, name, size_bytes, content_type, storage_class, created_at
       FROM objects
       WHERE bucket_id = $1
       ORDER BY created_at DESC`,
      [id]
    );

    res.json({
      bucket: bucket.rows[0],
      objects: objects.rows
    });
  } catch (err) {
    console.error('List objects error:', err);
    res.status(500).json({ error: 'Failed to list objects' });
  }
});

// Upload object (base64 JSON, max 2MB)
app.post('/api/buckets/:id/objects', async (req, res) => {
  const { id } = req.params;
  const { name, contentType, storageClass, base64Data } = req.body;

  if (!name || !base64Data) {
    return res.status(400).json({ error: 'Object name and base64Data are required' });
  }

  const validStorageClasses = ['Standard', 'Infrequent'];
  const finalStorageClass = validStorageClasses.includes(storageClass) ? storageClass : 'Standard';

  try {
    const bucket = await db.query('SELECT id FROM buckets WHERE id = $1', [id]);
    if (bucket.rows.length === 0) {
      return res.status(404).json({ error: 'Bucket not found' });
    }

    // Decode base64
    const buffer = Buffer.from(base64Data, 'base64');
    const sizeBytes = buffer.length;

    // Check max 2MB limit (2 * 1024 * 1024 = 2097152 bytes)
    if (sizeBytes > 2097152) {
      return res.status(400).json({ error: 'Object exceeds maximum size limit of 2MB' });
    }

    const mime = contentType || 'application/octet-stream';

    // Insert or update if exists
    const query = `
      INSERT INTO objects (bucket_id, name, size_bytes, content_type, storage_class, data)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (bucket_id, name)
      DO UPDATE SET
        size_bytes = EXCLUDED.size_bytes,
        content_type = EXCLUDED.content_type,
        storage_class = EXCLUDED.storage_class,
        data = EXCLUDED.data,
        created_at = CURRENT_TIMESTAMP
      RETURNING id, bucket_id, name, size_bytes, content_type, storage_class, created_at
    `;

    const result = await db.query(query, [id, name, sizeBytes, mime, finalStorageClass, buffer]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Upload object error:', err);
    res.status(500).json({ error: 'Failed to upload object' });
  }
});

// Download object
app.get('/api/buckets/:bucketId/objects/:objectId', async (req, res) => {
  const { bucketId, objectId } = req.params;
  try {
    const result = await db.query(
      'SELECT name, content_type, size_bytes, data FROM objects WHERE id = $1 AND bucket_id = $2',
      [objectId, bucketId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Object not found' });
    }

    const obj = result.rows[0];
    res.setHeader('Content-Type', obj.content_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${obj.name}"`);
    res.setHeader('Content-Length', obj.size_bytes);
    return res.send(obj.data);
  } catch (err) {
    console.error('Download object error:', err);
    res.status(500).json({ error: 'Failed to download object' });
  }
});

// Delete object
app.delete('/api/buckets/:bucketId/objects/:objectId', async (req, res) => {
  const { bucketId, objectId } = req.params;
  try {
    const result = await db.query(
      'DELETE FROM objects WHERE id = $1 AND bucket_id = $2 RETURNING id',
      [objectId, bucketId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Object not found' });
    }

    res.json({ message: 'Object deleted successfully' });
  } catch (err) {
    console.error('Delete object error:', err);
    res.status(500).json({ error: 'Failed to delete object' });
  }
});

async function start() {
  await db.connectWithRetry();
  await seedAdminUser();
  app.listen(PORT, () => {
    console.log(`Object Storage Backend running on port ${PORT}`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
