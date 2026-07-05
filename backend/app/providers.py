"""Provider adapter config. Adding a new provider is a new dict entry, not a rewrite."""

PROVIDERS = {
    "groq": {
        "chat_url": "https://api.groq.com/openai/v1/chat/completions",
        "key_env": "GROQ_API_KEY",
        "default_model": "llama-3.1-8b-instant",
    },
}


def get_provider(name: str) -> dict:
    provider = PROVIDERS.get(name)
    if provider is None:
        raise KeyError(f"Unknown provider: {name}")
    return provider
