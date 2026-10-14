from alembic import command

from app.core.migrations import alembic_config


def test_models_and_migrations_are_in_sync():
    # Fails when a model changed without a migration. Fix: bun run db:revision "describe the change"
    command.check(alembic_config())


def test_migrations_downgrade_and_upgrade_cleanly():
    config = alembic_config()
    command.downgrade(config, "base")
    command.upgrade(config, "head")
    command.check(config)
