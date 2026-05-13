// Shared types mirroring the Supabase schema. Keep in sync with supabase/schema.sql.

export type TicketStatus =
  | 'processing'
  | 'auto_sent'
  | 'human_review'
  | 'sent'
  | 'rejected'
  | 'error';

export type Category =
  | 'how_to_question'
  | 'bug_report'
  | 'feature_request'
  | 'account_issue'
  | 'billing'
  | 'other';

export type Verdict = 'auto_send' | 'human_review' | 'cannot_answer' | 'error';

export interface Ticket {
  id: string;
  external_id: string | null;
  subject: string;
  body: string;
  customer_email: string;
  status: TicketStatus;
  retry_count: number;
  created_at: string;
  completed_at: string | null;
}

export interface Classification {
  category: Category;
  classification_confidence: number;
  reasoning: string;
}

export interface TopChunk {
  chunk_id: string;
  doc_url: string;
  doc_title: string;
  category: Category | string;
  section_heading?: string | null;
  score: number;
  content_snippet: string;
}

export interface SelfGrade {
  grounded_in_cited_doc: number;
  directly_answers_question: number;
  tone_appropriate: number;
  justification: string;
}

export interface CitedDoc {
  doc_url: string;
  doc_title: string;
}

export interface TicketRun {
  id: string;
  ticket_id: string;
  classification: Classification;
  top_chunks: TopChunk[];
  draft_response: string | null;
  cited_docs: CitedDoc[] | null;
  self_grade: SelfGrade | null;
  verdict: Verdict;
  verdict_reason: string;
  auto_sent: boolean;
  latency_ms: number | null;
  prompt_versions: Record<string, string> | null;
  raw_llm_outputs: unknown | null;
  created_at: string;
}

export interface TicketWithLatestRun extends Ticket {
  latest_run: TicketRun | null;
}

export interface Settings {
  cosine_floor: number;
  cosine_margin: number;
  self_grade_floor: number;
  classification_conf_floor: number;
  hard_floor_top1_cosine: number;
  n8n_webhook_url: string;
  n8n_callback_secret: string;
}

export const CATEGORY_LABELS: Record<Category, string> = {
  how_to_question: 'How-to',
  bug_report: 'Bug',
  feature_request: 'Feature req',
  account_issue: 'Account',
  billing: 'Billing',
  other: 'Other',
};

export const CATEGORY_COLOURS: Record<Category, string> = {
  how_to_question: 'bg-sky-100 text-sky-700 border-sky-200',
  bug_report: 'bg-rose-100 text-rose-700 border-rose-200',
  feature_request: 'bg-violet-100 text-violet-700 border-violet-200',
  account_issue: 'bg-amber-100 text-amber-700 border-amber-200',
  billing: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  other: 'bg-gray-100 text-gray-700 border-gray-200',
};
