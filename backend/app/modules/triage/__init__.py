"""Triage: the persisted job lifecycle (QUEUED → PROCESSING → COMPLETED | FAILED), worker and sweeper.

Top of the dependency chain: triage → intelligence → cases/org/auth → core. The pipeline in `intelligence` returns
results; triage persists them through the owning module's service.
"""
