/**
 * erisa_aggregate_cap_guard.ts · SubFlow webhook: ERISA 25% Benefit Plan Investor (BPI) cap.
 * Case CASE-2025-029 · Ardent Growth Fund VII, L.P. (Main) + Ardent Growth Parallel Fund VII, L.P.
 * Author: sarah.tran · shipped 2025-07-25
 * Sarah: 29 C.F.R. §2510.3-101(f) is tested per entity and class; Addendum Section 6.4 adds a contractual
 * AGGREGATE limit across Main + Parallel. We measure all three scopes and decide on the worst.
 */
import { withTx, type Tx } from "../lib/db";
import type { SubFlowWebhookEvent } from "../lib/subflow-webhooks";

export type Decision = "ALLOW" | "WARN" | "HOLD";

export interface GuardResult {
  decision: Decision;
  projectedPct: number; // aggregate BPI % across Main + Parallel, 2 dp, display only
  headroomUsd: number; // extra BPI commitment acceptable before 25.00% (tightest scope); < 0 = over
  reason: string;
}

interface CommitmentRow {
  vehicleId: "MAIN" | "PARALLEL";
  commitmentCents: bigint; // USD cents; fx() already applied at prefill
  bpiWeightBps: number; // 10000 = full BPI; plan-asset entity = its own BPI %; 0 = not a BPI
  gpAffiliate: boolean; // GP, adviser or affiliate (Addendum Section 6.3)
}

interface Measure { scope: string; num: bigint; den: bigint } // num = Σ cents × weightBps

export const HANDLES = ["subscription.prefilled", "subscription.submitted", "subscription.pre_countersign"];
const WARN_BPS = 2250; // soft threshold 22.50%, agreed with the GP's CCO
const HOLD_BPS = 2500; // "25 percent or more" is significant participation, so HOLD at >= 25.00%
// Pending subscriptions COUNT. The dry run broke because each packet only saw approved commitments.
const COUNTED = ["SUBMITTED", "IN_REVIEW", "GP_APPROVED", "COUNTERSIGNED"];

export async function erisaAggregateCapGuard(evt: SubFlowWebhookEvent): Promise<GuardResult> {
  const familyId = evt.fund.parallelFamilyId; // Main and Parallel share one family id

  // Sarah: READ COMMITTED on purpose. Under REPEATABLE READ / SERIALIZABLE, Postgres takes the snapshot
  // at the first statement (the lock call itself, before it waits), so we would count a stale book.
  return withTx({ isolation: "READ COMMITTED" }, async (tx) => {
    // ONE lock per fund family, taken BEFORE any read. On 2025-07-22 four pensions landed within
    // 6 minutes and every packet read 17.44% because none could see the other three.
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`erisa-cap:${familyId}`]);

    // Idempotent per delivery, not per subscription: a retry gets the stored answer, but a new GP
    // attempt after the book changed (scale-back, deferral) must re-count.
    const prior = await tx.maybeOne<{ result: GuardResult }>(
      "SELECT result FROM erisa_guard_decisions WHERE delivery_id = $1", [evt.deliveryId]);
    if (prior) return prior.result;

    const rows = await loadCommitments(tx, familyId, evt.subscriptionId);
    const aggregate = measure("aggregate", rows);
    const vehicles = (["MAIN", "PARALLEL"] as const).map((v) => measure(v, rows.filter((r) => r.vehicleId === v)));
    const scopes = [aggregate, ...vehicles];

    const decision: Decision = scopes.some((m) => atOrAbove(m, HOLD_BPS)) ? "HOLD"
      : scopes.some((m) => atOrAbove(m, WARN_BPS)) ? "WARN" : "ALLOW";
    const headroomCents = scopes.map(headroom).reduce((a, b) => (b < a ? b : a));
    const detail = vehicles.map((m) => `${m.scope} ${pct(m).toFixed(2)}%`).join(", ");

    const result: GuardResult = {
      decision,
      projectedPct: pct(aggregate),
      headroomUsd: Number(headroomCents) / 100,
      reason: `${decision}: aggregate BPI ${pct(aggregate).toFixed(2)}% (${detail}); warn 22.50% / hold ` +
        `25.00%. HOLD blocks GP acceptance; Section 6.4(d) lets the GP reduce, reject or defer.`,
    };
    await tx.query(
      `INSERT INTO erisa_guard_decisions (delivery_id, family_id, subscription_id, event_type, result)
       VALUES ($1, $2, $3, $4, $5)`,
      [evt.deliveryId, familyId, evt.subscriptionId, evt.type, result],
    );
    return result;
  });
}

async function loadCommitments(tx: Tx, familyId: string, incomingId: string): Promise<CommitmentRow[]> {
  // The incoming subscription is included whatever its status, so prefill drafts get a projection.
  const rows = await tx.many<Record<string, string | boolean | null>>(
    `SELECT s.vehicle_code, s.commitment_usd_cents, s.bpi_weight_bps, s.gp_affiliate
       FROM subscriptions s JOIN vehicles v ON v.id = s.vehicle_id
      WHERE v.parallel_family_id = $1 AND (s.status = ANY($2) OR s.id = $3)`,
    [familyId, COUNTED, incomingId],
  );
  return rows.map((r) => ({
    vehicleId: r.vehicle_code as CommitmentRow["vehicleId"],
    commitmentCents: BigInt(r.commitment_usd_cents as string),
    // Sarah: unclassified (null) counts as a full BPI until Schedule A says otherwise. Fail closed.
    bpiWeightBps: r.bpi_weight_bps === null ? 10000 : Number(r.bpi_weight_bps),
    gpAffiliate: r.gp_affiliate === true,
  }));
}

function measure(scope: string, rows: CommitmentRow[]): Measure {
  let [num, den] = [0n, 0n];
  for (const r of rows) {
    // §2510.3-101(f)(1): disregard GP/adviser/affiliate interests, unless the holder is itself a BPI.
    if (r.gpAffiliate && r.bpiWeightBps === 0) continue;
    den += r.commitmentCents;
    num += r.commitmentCents * BigInt(r.bpiWeightBps);
  }
  return { scope, num, den };
}

// Exact integer compare: never test the rounded 2 dp figure (24.996% displays as 25.00%).
const atOrAbove = (m: Measure, bps: number) => m.den > 0n && m.num >= m.den * BigInt(bps);
const pct = (m: Measure) => (m.den === 0n ? 0 : Number((m.num * 2n + m.den) / (2n * m.den)) / 100);
// BPI dollars h that keep (N + h) / (D + h) below 25%:  h = (0.25·D − N) / 0.75, in cents.
const headroom = (m: Measure) => (BigInt(HOLD_BPS) * m.den - m.num) / BigInt(10000 - HOLD_BPS);
