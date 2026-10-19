from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --- Auth / users --------------------------------------------------------------------------------

class RegisterIn(BaseModel):
    email: EmailStr
    name: str = Field(min_length=2, max_length=80)
    password: str = Field(min_length=10, max_length=128)
    terms: Literal[True]
    ref: str | None = Field(None, max_length=16)
    promo: str | None = Field(None, max_length=40)
    utm_source: str | None = Field(None, max_length=64)
    utm_campaign: str | None = Field(None, max_length=100)


class LoginIn(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=128)


class UserOut(ORM):
    id: int
    email: str
    name: str
    role: str
    status: str
    balance: int
    created_at: datetime


class RegisterOut(UserOut):
    notices: list[str] = []


class ForgotIn(BaseModel):
    email: str = Field(max_length=254)


class ResetIn(BaseModel):
    token: str = Field(min_length=20, max_length=200)
    password: str = Field(min_length=10, max_length=128)


class ProfileIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)


class PasswordIn(BaseModel):
    current: str
    new: str = Field(min_length=10, max_length=128)


# --- Models & billing ----------------------------------------------------------------------------

class AIModelOut(ORM):
    id: int
    slug: str
    provider: str
    title: str
    description: str
    badge: str | None
    context_window: int
    input_price: float
    output_price: float
    is_default: bool


class AIModelAdmin(AIModelOut):
    provider_model: str
    cost_input_usd: float
    cost_output_usd: float
    is_active: bool
    sort: int


class AIModelUpdate(BaseModel):
    title: str | None = Field(None, max_length=80)
    description: str | None = None
    badge: str | None = Field(None, max_length=24)
    provider_model: str | None = Field(None, max_length=128)
    input_price: float | None = Field(None, ge=0)
    output_price: float | None = Field(None, ge=0)
    cost_input_usd: float | None = Field(None, ge=0)
    cost_output_usd: float | None = Field(None, ge=0)
    is_active: bool | None = None
    is_default: bool | None = None
    sort: int | None = None


class PackageOut(ORM):
    id: int
    slug: str
    title: str
    tokens: int
    price_kopeks: int
    bonus_percent: int
    highlight: bool


class LedgerOut(ORM):
    id: int
    amount: int
    balance_after: int
    kind: str
    description: str
    created_at: datetime


class TopupIn(BaseModel):
    """Either a ready package or a custom amount in rubles."""

    package_slug: str | None = None
    amount_rub: int | None = Field(None, ge=500, le=500_000)
    promo_code: str | None = Field(None, max_length=40)


class PaymentOut(ORM):
    id: int
    amount_kopeks: int
    tokens: int
    status: str
    provider: str
    created_at: datetime


# --- Chats ---------------------------------------------------------------------------------------

class ChatIn(BaseModel):
    title: str | None = Field(None, max_length=120)
    model_id: int | None = None
    agent_id: int | None = None
    project_id: int | None = None
    knowledge_base_id: int | None = None


class ChatUpdate(BaseModel):
    title: str | None = Field(None, max_length=120)
    model_id: int | None = None
    knowledge_base_id: int | None = None
    pinned: bool | None = None


class ChatOut(ORM):
    id: int
    title: str
    model_id: int | None
    agent_id: int | None
    project_id: int | None
    knowledge_base_id: int | None
    pinned: bool
    summary: str
    updated_at: datetime


class MessageOut(ORM):
    id: int
    role: str
    content: str
    model_slug: str | None
    prompt_tokens: int
    completion_tokens: int
    cost: int
    sources: list
    created_at: datetime


class SendIn(BaseModel):
    content: str = Field(min_length=1, max_length=32_000)
    model_id: int | None = None


# --- Agents & knowledge --------------------------------------------------------------------------

class AgentIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    description: str = Field("", max_length=300)
    emoji: str = Field("✦", max_length=8)
    color: str = Field("violet", max_length=16)
    system_prompt: str = Field(min_length=10, max_length=8000)
    model_id: int | None = None
    temperature: float = Field(0.7, ge=0, le=1.5)
    knowledge_base_id: int | None = None


class AgentOut(ORM):
    id: int
    user_id: int | None
    name: str
    description: str
    emoji: str
    color: str
    system_prompt: str
    model_id: int | None
    temperature: float
    knowledge_base_id: int | None


class KnowledgeBaseIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    description: str = Field("", max_length=300)


class KnowledgeBaseOut(ORM):
    id: int
    name: str
    description: str
    created_at: datetime
    documents_count: int = 0


class DocumentOut(ORM):
    id: int
    filename: str
    size_bytes: int
    status: str
    chunks_count: int
    error: str | None
    created_at: datetime


class SearchHit(BaseModel):
    document_id: int
    filename: str
    content: str
    score: float


# --- Projects, packs, studio ---------------------------------------------------------------------

class ProjectIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    description: str = Field("", max_length=280)
    brand_context: str = Field("", max_length=6000)
    tone: str = Field("", max_length=80)


class ProjectOut(ORM):
    id: int
    name: str
    description: str
    brand_context: str
    tone: str
    created_at: datetime
    updated_at: datetime


class PackStep(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    tool: Literal["post", "plan", "rewrite", "ideas", "script"]


class PackOut(ORM):
    id: int
    slug: str | None = None
    title: str
    description: str
    emoji: str = "✦"
    steps: list[PackStep]


class ProjectPackIn(BaseModel):
    pack_id: int | None = None
    title: str | None = Field(None, max_length=80)
    description: str = Field("", max_length=280)
    steps: list[PackStep] = Field(default_factory=list, max_length=10)


class GenerateIn(BaseModel):
    tool: Literal["post", "plan", "rewrite", "ideas", "script"]
    input: dict[str, str]
    model_id: int | None = None
    project_id: int | None = None


class GenerationOut(ORM):
    id: int
    project_id: int | None
    tool: str
    input: dict
    output: str
    model_slug: str
    cost: int
    created_at: datetime



# --- Admin ---------------------------------------------------------------------------------------

class AdminUserOut(UserOut):
    last_seen_at: datetime | None
    signup_source: str = ""
    signup_campaign: str = ""
    signup_promo: str = ""
    referred_by_id: int | None = None


class AdminBalanceIn(BaseModel):
    amount: int = Field(ne=0, ge=-100_000_000, le=100_000_000)
    comment: str = Field(min_length=2, max_length=200)


class AdminUserUpdate(BaseModel):
    status: Literal["active", "blocked"] | None = None
    role: Literal["user", "admin"] | None = None


class PromoIn(BaseModel):
    code: str = Field(min_length=3, max_length=40, pattern=r"^[A-Za-z0-9_-]+$")
    kind: Literal["gift", "topup"]
    value: int = Field(gt=0, le=1_000_000)
    min_topup_rub: int = Field(0, ge=0)
    max_uses: int | None = Field(None, gt=0)
    new_users_only: bool = False
    expires_at: datetime | None = None
    source: str = Field("", max_length=64)
    note: str = Field("", max_length=200)


class PromoUpdate(BaseModel):
    is_active: bool | None = None
    max_uses: int | None = None
    expires_at: datetime | None = None
    note: str | None = Field(None, max_length=200)


class PromoOut(ORM):
    id: int
    code: str
    kind: str
    value: int
    min_topup_rub: int
    max_uses: int | None
    uses: int
    new_users_only: bool
    expires_at: datetime | None
    source: str
    note: str
    is_active: bool
    created_at: datetime


class RedeemIn(BaseModel):
    code: str = Field(min_length=1, max_length=40)
