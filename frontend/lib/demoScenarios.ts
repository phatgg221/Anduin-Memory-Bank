import type { CaseIntake } from "@/types/rooms";

export interface DemoScenario {
  id: string;
  label: string;
  departmentId: string;
  people: string[];
  intake: Omit<CaseIntake, "lead_user_id">;
}

/** "⚡ Load demo scenario" presets: realistic incoming requests that exercise the live matching pipeline. */
export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: "aurelian",
    label: "Aurelian Global — Cayman Feeder II (joint signers, 10% AML, $15M MFN)",
    departmentId: "CLIENT_OPERATIONS",
    people: ["Sarah Tran", "Elena Rostova"],
    intake: {
      client_name: "Aurelian Global Management",
      fund_name: "Aurelian Crossover Feeder II (Cayman master-feeder)",
      source_type: "CLIENT_EMAIL",
      title: "Crossover Feeder II — joint signers, 10% UBO look-through and sovereign MFN",
      initial_request_brief:
        "From: fund-ops@aurelian.example\nOur two non-US institutional signers are both locked at Step 4 of the W-8BEN-E in the pilot. " +
        "Counsel also wants the CIMA AML beneficial-ownership look-through at 10% (four tiers) for every investor, and the " +
        "sovereign wealth side letters need an MFN fee bracket starting at $15M instead of $25M. Some family offices will fund " +
        "from hardware wallets, so we need a custody attestation annex too. First close is 15 Dec.",
      severity: "HIGH",
      due_date: "2026-12-15",
      context_tags: { Jurisdiction: "Cayman Islands", "Tax Form": "W-8BEN-E", "Fund Structure": "Master-Feeder" },
      secondary_department_ids: ["LEGAL_COMPLIANCE"],
    },
  },
  {
    id: "altmark",
    label: "Altmark Global Investors — €450k EU private wealth & DORA security RFP",
    departmentId: "SALES_SOLUTIONS",
    people: ["Elena Rostova", "Marcus Vance"],
    intake: {
      client_name: "Altmark Global Investors",
      fund_name: "European private wealth feeder platform",
      source_type: "SECURITY_RFP",
      title: "EU private wealth feeder — DORA, Frankfurt residency and Swiss confidentiality RFP",
      initial_request_brief:
        "Altmark sent a 160-question security and scoping RFP (about €450k ARR). 1,800 HNW investors managed by ~40 wealth " +
        "managers with monthly closings. They need proof that investor data and AI inference stay in Frankfurt under EU DORA, " +
        "zero retention by AI sub-processors, and a Swiss client confidentiality addendum for Swiss-booked investors. Due 6 Nov.",
      severity: "MEDIUM",
      due_date: "2026-11-06",
      context_tags: {
        Regulation: "EU DORA / GDPR",
        "Data Residency": "Frankfurt (eu-central-1)",
        "Client Segment": "Private Wealth",
      },
      secondary_department_ids: ["LEGAL_COMPLIANCE", "ENGINEERING_DATA"],
    },
  },
  {
    id: "tidemark",
    label: "Tidemark Capital — 650-LP DealLedger migration & bank email quarantine",
    departmentId: "CUSTOMER_SUCCESS",
    people: ["Sarah Tran", "Marcus Vance"],
    intake: {
      client_name: "Tidemark Capital",
      fund_name: "Tidemark legacy LP base (DealLedger migration)",
      source_type: "CS_ESCALATION",
      title: "DealLedger migration — duplicated trusts, EUR/JPY wire failures, missing portal invites",
      initial_request_brief:
        "Escalation: Tidemark is migrating 650 legacy LP entities from DealLedger ahead of the Q1 capital call and K-1 distribution. " +
        "Family trusts are duplicated once per trustee, EUR/JPY wires fail validation by 0.02-0.11% of the call, and LPs at " +
        "Cityline and Rhone Union never received their portal invites (no bounces). 118 dormant users still need MFA.",
      severity: "CRITICAL",
      due_date: "2026-10-31",
      context_tags: { Integration: "DealLedger CRM", Currencies: "EUR / JPY / USD", Workflow: "Capital Calls" },
      secondary_department_ids: ["ENGINEERING_DATA", "CLIENT_OPERATIONS"],
    },
  },
];
