from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Nova AI"
    environment: str = "development"
    database_url: str = "postgresql+asyncpg://nova:nova@localhost:5432/nova"
    redis_url: str | None = "redis://localhost:6379/0"
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])

    cookie_secure: bool = False
    session_days: int = 14

    admin_email: str | None = None
    admin_password: str | None = None

    # Provider keys stay server-side; with none set, a labelled dev provider answers.
    openai_api_key: str | None = None
    openai_base_url: str | None = None
    anthropic_api_key: str | None = None
    embedding_model: str = "text-embedding-3-small"
    embedding_dim: int = 1536
    embedding_cost_usd: float = 0.02  # per 1M tokens

    # Billing: new users get a welcome balance; top-ups go through PAYMENT_PROVIDER.
    welcome_tokens: int = 50  # sparks
    usd_rub: float = 95.0  # for cost monitoring in the admin
    # Referral program
    referral_signup_bonus: int = 50  # sparks for the invited friend on sign-up
    referral_percent: int = 10  # % of the friend's paid sparks credited to the referrer
    payment_provider: str = "mock"  # mock | yookassa
    public_url: str = "http://localhost:8080"
    yookassa_shop_id: str | None = None
    yookassa_secret_key: str | None = None

    # Context window management for chats.
    context_budget_tokens: int = 12_000
    summary_trigger_messages: int = 24
    rag_top_k: int = 5

    rate_limit_per_minute: int = 30
    max_upload_mb: int = 10

    # Mail. Support address is shown on the site and receives tickets.
    support_email: str = "support@24nova-ai.ru"
    smtp_host: str | None = None  # Timeweb: smtp.timeweb.ru
    smtp_port: int = 465
    smtp_security: str = "ssl"  # ssl (465) | starttls (587)
    smtp_user: str | None = None
    smtp_password: str | None = None
    smtp_from: str | None = None  # defaults to smtp_user

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def mail_enabled(self) -> bool:
        return bool(self.smtp_host and self.smtp_user and self.smtp_password)

    def production_problems(self) -> list[str]:
        """Settings that are unsafe to run in production. Empty list means OK."""
        problems = []
        if not self.cookie_secure:
            problems.append("COOKIE_SECURE должен быть true (сайт работает по HTTPS)")
        if not self.public_url.startswith("https://"):
            problems.append("PUBLIC_URL должен начинаться с https://")
        weak = {None, "", "change-me-please", "admin", "password"}
        if self.admin_email and (self.admin_password in weak or len(self.admin_password or "") < 12):
            problems.append("ADMIN_PASSWORD слишком простой (нужно 12+ символов, не дефолтный)")
        if "nova:nova@" in self.database_url:
            problems.append("POSTGRES_PASSWORD не задан (используется дефолтный nova)")
        return problems

    def production_warnings(self) -> list[str]:
        """Not fatal (the site works), but a feature is off until configured."""
        warnings = []
        if not self.openai_api_key:
            warnings.append("OPENAI_API_KEY пуст — чаты и услуги будут отвечать «модель недоступна»")
        if not (self.payment_provider == "yookassa" and self.yookassa_shop_id and self.yookassa_secret_key):
            warnings.append("ЮKassa не настроена — пополнение баланса закрыто")
        if not self.mail_enabled:
            warnings.append("SMTP не настроен — письма (поддержка, восстановление пароля) не отправляются")
        return warnings


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
