"""The Engine must not come up guarded by a password anyone can read in the repo."""
from app.config import Settings


def cfg(**over) -> Settings:
    return Settings(_env_file=None, **{"engine_api_keys": "a-real-long-key", **over})


def test_real_secrets_pass():
    assert cfg(webhook_url="https://app.test/hook", webhook_secret="a-real-secret").secret_problems() == []


def test_default_api_key_is_refused():
    assert any("ENGINE_API_KEYS" in p for p in cfg(engine_api_keys="dev-key").secret_problems())


def test_placeholder_api_key_is_refused_even_beside_a_real_one():
    keys = "a-real-long-key,change-me-to-a-long-random-string"
    assert any("ENGINE_API_KEYS" in p for p in cfg(engine_api_keys=keys).secret_problems())


def test_empty_api_keys_are_refused():
    assert any("ENGINE_API_KEYS" in p for p in cfg(engine_api_keys=" , ").secret_problems())


def test_default_webhook_secret_is_refused_when_webhooks_are_on():
    problems = cfg(webhook_url="https://app.test/hook", webhook_secret="dev-secret").secret_problems()
    assert any("WEBHOOK_SECRET" in p for p in problems)


def test_webhook_secret_is_unused_without_a_webhook():
    assert cfg(webhook_url="", webhook_secret="dev-secret").secret_problems() == []


def test_local_development_can_opt_in():
    assert cfg(engine_api_keys="dev-key", allow_dev_secrets=True).secret_problems() == []
