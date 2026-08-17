function normalizeJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    type: row.type,
    payload: row.payload,
    idempotencyKey: row.idempotency_key ?? null,
    status: row.status,
    attemptCount: Number(row.attempt_count ?? 0),
    maxAttempts: Number(row.max_attempts ?? 0),
    availableAt: row.available_at ?? null,
    leaseOwner: row.lease_owner ?? null,
    leasedUntil: row.leased_until ?? null,
    lastError: row.last_error ?? null
  };
}

function sanitizeFailure() {
  return 'job_failed';
}

export class PostgresJobQueue {
  constructor({
    pool,
    ownerId,
    leaseMs = 60_000,
    baseRetryMs = 1_000,
    maxRetryMs = 60_000,
    jitter = Math.random
  }) {
    if (!pool?.query || !pool?.connect) throw new Error('PostgresJobQueue pool is required');
    if (!ownerId) throw new Error('PostgresJobQueue ownerId is required');
    this.pool = pool;
    this.ownerId = String(ownerId);
    this.leaseMs = Math.max(1_000, Number(leaseMs) || 60_000);
    this.baseRetryMs = Math.max(100, Number(baseRetryMs) || 1_000);
    this.maxRetryMs = Math.max(this.baseRetryMs, Number(maxRetryMs) || 60_000);
    this.jitter = jitter;
  }

  async enqueue({ tenantId, type, payload = {}, idempotencyKey = null, maxAttempts = 5 }) {
    if (!tenantId || !type) throw new Error('job_tenant_and_type_required');
    const result = await this.pool.query(
      `INSERT INTO durable_jobs (
         id, tenant_id, type, payload, idempotency_key, status,
         attempt_count, max_attempts, available_at, created_at, updated_at
       ) VALUES (
         gen_random_uuid()::text, $1, $2, $3::jsonb, $4, 'queued',
         0, $5, NOW(), NOW(), NOW()
       )
       ON CONFLICT (tenant_id, type, idempotency_key)
       DO UPDATE SET updated_at = durable_jobs.updated_at
       RETURNING *`,
      [String(tenantId), String(type), payload, idempotencyKey ? String(idempotencyKey) : null, Math.max(1, Number(maxAttempts) || 5)]
    );
    return normalizeJob(result.rows[0]);
  }

  async claimNext() {
    const client = await this.pool.connect();
    let began = false;
    try {
      await client.query('BEGIN');
      began = true;
      const selected = await client.query(
        `SELECT *
         FROM durable_jobs
         WHERE (
           (status = 'queued' AND available_at <= NOW())
           OR (status = 'running' AND leased_until <= NOW())
         )
         ORDER BY available_at ASC, created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1`
      );
      if (!selected.rows[0]) {
        await client.query('COMMIT');
        began = false;
        return null;
      }

      const updated = await client.query(
        `UPDATE durable_jobs
         SET status = 'running',
             attempt_count = attempt_count + 1,
             lease_owner = $2,
             leased_until = NOW() + ($3::bigint * INTERVAL '1 millisecond'),
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [selected.rows[0].id, this.ownerId, this.leaseMs]
      );
      await client.query('COMMIT');
      began = false;
      return normalizeJob(updated.rows[0]);
    } catch (error) {
      if (began) {
        try { await client.query('ROLLBACK'); } catch {}
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async complete(job) {
    const id = typeof job === 'string' ? job : job?.id;
    if (!id) throw new Error('job_id_required');
    const result = await this.pool.query(
      `UPDATE durable_jobs
       SET status = 'completed', lease_owner = NULL, leased_until = NULL,
           completed_at = NOW(), updated_at = NOW(), last_error = NULL
       WHERE id = $1
       RETURNING *`,
      [id]
    );
    return normalizeJob(result.rows[0]);
  }

  retryDelayMs(attemptCount) {
    const exponent = Math.max(0, Number(attemptCount) - 1);
    const base = Math.min(this.maxRetryMs, this.baseRetryMs * (2 ** exponent));
    const jitterValue = Math.max(0, Math.min(1, Number(this.jitter()) || 0));
    return Math.min(this.maxRetryMs, Math.round(base + base * 0.2 * jitterValue));
  }

  async fail(job, _error) {
    if (!job?.id) throw new Error('job_id_required');
    const attemptCount = Number(job.attemptCount ?? 0);
    const maxAttempts = Math.max(1, Number(job.maxAttempts ?? 1));
    const failureCode = sanitizeFailure();

    if (attemptCount >= maxAttempts) {
      const result = await this.pool.query(
        `UPDATE durable_jobs
         SET status = 'dead', lease_owner = NULL, leased_until = NULL,
             last_error = $2, updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [job.id, failureCode]
      );
      return normalizeJob(result.rows[0]);
    }

    const delayMs = this.retryDelayMs(attemptCount);
    const result = await this.pool.query(
      `UPDATE durable_jobs
       SET status = 'queued', lease_owner = NULL, leased_until = NULL,
           available_at = NOW() + ($2::bigint * INTERVAL '1 millisecond'),
           last_error = $3, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [job.id, delayMs, failureCode]
    );
    return normalizeJob(result.rows[0]);
  }
}
