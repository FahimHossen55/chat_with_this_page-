import pytest

from app.providers import get_provider


def test_get_provider_known():
    provider = get_provider("groq")
    assert provider["chat_url"] == "https://api.groq.com/openai/v1/chat/completions"
    assert provider["key_env"] == "GROQ_API_KEY"
    assert provider["default_model"]


def test_get_provider_unknown_raises_keyerror():
    with pytest.raises(KeyError):
        get_provider("does-not-exist")
