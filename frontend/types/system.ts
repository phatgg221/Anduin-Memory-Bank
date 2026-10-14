// Mirrors backend app/health.py HealthOut.
export interface Health {
  status: "ok" | "degraded";
  database: boolean;
  pgvector: string | null;
  storage: boolean;
}
