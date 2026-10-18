export type User = {
  id: number;
  email: string;
  name: string;
  role: "user" | "admin";
  status: "active" | "blocked";
  balance: number;
  created_at: string;
  last_seen_at?: string | null;
  signup_source?: string;
  signup_campaign?: string;
  signup_promo?: string;
  referred_by_id?: number | null;
};

export type AIModel = {
  id: number;
  slug: string;
  provider: "openai" | "anthropic";
  title: string;
  description: string;
  badge: string | null;
  context_window: number;
  input_price: number;
  output_price: number;
  is_default: boolean;
  provider_model?: string;
  cost_input_usd?: number;
  cost_output_usd?: number;
  is_active?: boolean;
  sort?: number;
};

export type Chat = {
  id: number;
  title: string;
  model_id: number | null;
  agent_id: number | null;
  project_id: number | null;
  knowledge_base_id: number | null;
  pinned: boolean;
  summary: string;
  updated_at: string;
};

export type SourceRef = { n: number; document_id: number; filename: string; score: number; excerpt: string };

export type Message = {
  id: number;
  role: "user" | "assistant";
  content: string;
  model_slug: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  cost: number;
  sources: SourceRef[];
  created_at: string;
};

export type Agent = {
  id: number;
  user_id: number | null;
  name: string;
  description: string;
  emoji: string;
  color: string;
  system_prompt: string;
  model_id: number | null;
  temperature: number;
  knowledge_base_id: number | null;
};

export type KnowledgeBase = { id: number; name: string; description: string; created_at: string; documents_count: number };

export type Doc = {
  id: number;
  filename: string;
  size_bytes: number;
  status: "processing" | "ready" | "failed";
  chunks_count: number;
  error: string | null;
  created_at: string;
};

export type Project = {
  id: number;
  name: string;
  description: string;
  brand_context: string;
  tone: string;
  created_at: string;
  updated_at: string;
};

export type Tool = "post" | "plan" | "rewrite" | "ideas" | "script";
export type PackStep = { title: string; tool: Tool };
export type Pack = { id: number; slug?: string | null; title: string; description: string; emoji: string; steps: PackStep[] };

export type Generation = {
  id: number;
  project_id: number | null;
  tool: Tool;
  input: Record<string, string>;
  output: string;
  model_slug: string;
  cost: number;
  created_at: string;
};

export type Package = {
  id: number;
  slug: string;
  title: string;
  tokens: number;
  price_kopeks: number;
  bonus_percent: number;
  highlight: boolean;
};

export type LedgerEntry = {
  id: number;
  amount: number;
  balance_after: number;
  kind: "welcome" | "topup" | "usage" | "admin" | "refund" | "promo" | "referral";
  description: string;
  created_at: string;
};

export type ServiceField = { name: string; label: string; placeholder: string; textarea: boolean; required: boolean; options: string[] };
export type Service = {
  slug: string;
  title: string;
  emoji: string;
  category: string;
  description: string;
  price: number;
  fields: ServiceField[];
  result: "text" | "agent";
  badge: string | null;
  perks: string[];
};

export type Estimates = {
  scenarios: { emoji: string; title: string; description: string; sparks: number; package: string | null; items: { label: string; sparks: number }[] }[];
  per_message: { model: string; slug: string; sparks: number; sparks_rag: number }[];
  services: { title: string; emoji: string; sparks: number }[];
};
