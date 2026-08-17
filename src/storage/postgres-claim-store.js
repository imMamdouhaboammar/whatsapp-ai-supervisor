export class PostgresClaimStore {
  constructor({ pool }) {
    if (!pool?.query) throw new Error('PostgresClaimStore pool is required');
    this.pool = pool;
  }

  async claim(key) {
    const claimKey = String(key);
    if (!claimKey) throw new Error('claim_key_required');
    const result = await this.pool.query(
      `INSERT INTO inbound_claims (claim_key, claimed_at)
       VALUES ($1, NOW())
       ON CONFLICT (claim_key) DO NOTHING
       RETURNING claim_key`,
      [claimKey]
    );
    return result.rowCount > 0;
  }

  async release(key) {
    const claimKey = String(key);
    if (!claimKey) return;
    await this.pool.query('DELETE FROM inbound_claims WHERE claim_key = $1', [claimKey]);
  }
}
