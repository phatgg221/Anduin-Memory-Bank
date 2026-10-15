# Frankfurt Regional Isolation & Zero-Retention AI Architecture Brief
*EU tenant · Version 1.0 of 8 October 2025 · Authors: David Le, Marcus Vance · Prepared for EU DORA and GDPR due diligence (CASE-2025-081)*

This brief describes where EU tenant data lives and how it moves, including AI features. It supports answers to client questionnaires under Regulation (EU) 2022/2554 (DORA), in particular Article 30(2)(b) on the locations where data is processed, and under the GDPR. It describes architecture and contractual controls; it is not a legal opinion, and each client remains responsible for its own regulatory assessment.

## Section 1. Scope

The EU tenant hosts fund subscription, investor onboarding and document data for clients that elect EU hosting. "LP personal data" means identification, contact, tax, beneficial ownership, screening, bank and signature data of investors, signatories and controlling persons.

## Section 2. Regional Isolation

| Component | Location | Notes |
|---|---|---|
| Application and API | AWS eu-central-1 (Frankfurt), 3 availability zones | Dedicated EU VPC |
| Relational database and read replicas | eu-central-1 | Multi-AZ; no cross-region replicas |
| Document store | eu-central-1 | Per-tenant encryption keys |
| Backups and snapshots | eu-central-1 | Cross-AZ only; 35-day retention |
| Search index | eu-central-1 | |
| Logs and metrics | eu-central-1 observability stack | LP personal data redacted before ingestion |
| LLM inference | AI provider's EU region endpoint (Frankfurt) | Zero-data-retention terms; see Section 4 |

(a) The EU VPC denies all egress except to an allow-list of EU endpoints. The allow-list is reviewed monthly and exported as evidence.
(b) Until September 2025 the EU tenant sent LLM calls to the AI provider's US endpoint and shipped logs to a US observability stack. Both were moved to eu-central-1 before any EU DORA questionnaire answer said otherwise.

## Section 3. Encryption and Keys

- At rest: AES-256 with keys held in AWS KMS in eu-central-1. KMS keys are regional and cannot be used from another region.
- In transit: TLS 1.2 or higher, including between services inside the VPC.
- Document store: one key per tenant, so a tenant's documents can be crypto-shredded on exit.

<!-- pagebreak -->

## Section 4. AI Features: Zero Retention, No Training

(a) **Off by default.** AI features are disabled for EU tenants until the client's administrator enables them; disabling them stops every call to the AI sub-processor.
(b) **EU-only inference.** Prompts and outputs for the EU tenant are sent only to the AI provider's EU region endpoint.
(c) **Contractual zero retention.** The AI provider's data processing agreement, amended on 24 September 2025, provides that prompts and outputs are not stored after the response is returned, are not used for training or improving models, and are processed only in the EU region.
(d) **Minimisation.** Only the fields a feature needs are sent; bank account numbers and full tax identifiers are never included in prompts.
(e) **Sub-processor governance.** The AI provider appears on the sub-processor list with its country and function, and any change is notified 30 days in advance with a right to object.

## Section 5. Support Access from Outside the EEA

Data stays in eu-central-1, but remote viewing by support staff outside the EEA is a transfer under the GDPR. It is controlled as follows:

| Control | Detail |
|---|---|
| Default view | LP personal data masked in the support console |
| Access | Just-in-time session tied to a support ticket |
| Unmasking | Requires a client-approved ticket; time-boxed to 4 hours |
| Logging | Every session and unmask event logged in eu-central-1 and available to the client |
| Legal basis | 2021 Standard Contractual Clauses (Decision (EU) 2021/914) with a transfer impact assessment |

## Section 6. DORA Contract Mapping

| DORA reference | Where it is addressed |
|---|---|
| Art. 30(2)(a): description of functions and subcontracting | MSA DORA addendum §5 and the sub-processor list |
| Art. 30(2)(b): locations of processing and storage | Sections 2 and 5 of this brief; notice before any change |
| Art. 30(2)(f): assistance in ICT incidents | MSA DORA addendum §6 |
| Art. 30(3)(e): access, inspection and audit | MSA DORA addendum §7 |
| Art. 30(3)(f): exit strategies | MSA DORA addendum §9 |

> Note: whether a service supports a critical or important function is the financial entity's own classification. This brief supplies the inputs for that assessment.
