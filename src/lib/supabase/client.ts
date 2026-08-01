import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Finding, FindingStatus, ProjectMeta } from '../../types';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && anon);

export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url!, anon!)
  : null;

export interface DbFinding {
  id?: string;
  project_id: string;
  kind: string;
  category: string;
  start_offset: number;
  end_offset: number;
  page: number;
  source_url: string | null;
  source_title: string | null;
  match_pct: number | null;
  explanation: string | null;
  suggestion: string | null;
  status: string;
  text_snapshot?: string | null;
  is_informational?: boolean;
  confidence?: number;
  source_type?: string | null;
  citation_warning?: boolean;
}

export async function saveProject(
  userId: string,
  meta: ProjectMeta,
  findings: Finding[]
): Promise<string | null> {
  if (!supabase) return null;

  const { data: project, error } = await supabase
    .from('projects')
    .insert({
      user_id: userId,
      title: meta.title,
      similarity_pct: meta.similarityPct,
      ai_pct: meta.aiPct,
      report_format_version: meta.reportFormatVersion,
    })
    .select('id')
    .single();

  if (error || !project) {
    console.error('saveProject', error);
    return null;
  }

  const rows: DbFinding[] = findings.map((f) => ({
    project_id: project.id,
    kind: f.kind,
    category: f.category,
    start_offset: f.startOffset,
    end_offset: f.endOffset,
    page: f.page,
    source_url: f.sourceUrl,
    source_title: f.sourceTitle,
    match_pct: f.matchPct,
    explanation: f.explanation,
    suggestion: f.suggestion,
    status: f.status,
    text_snapshot: f.text.slice(0, 500),
    is_informational: f.isInformational,
    confidence: f.confidence,
    source_type: f.sourceType,
    citation_warning: f.citationWarning ?? false,
  }));

  if (rows.length) {
    const { error: fErr } = await supabase.from('findings').insert(rows);
    if (fErr) console.error('save findings', fErr);
  }

  return project.id as string;
}

export async function updateFindingStatus(
  findingId: string,
  status: FindingStatus,
  extra?: { userNote?: string; editedText?: string; citationWarning?: boolean }
): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from('findings')
    .update({
      status,
      ...(extra?.userNote != null ? { user_note: extra.userNote } : {}),
      ...(extra?.editedText != null ? { edited_text: extra.editedText } : {}),
      ...(extra?.citationWarning != null ? { citation_warning: extra.citationWarning } : {}),
    })
    .eq('id', findingId);
  if (error) console.error('updateFindingStatus', error);
}

export async function listProjects(userId: string) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('projects')
    .select('id, title, created_at, similarity_pct, ai_pct')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) {
    console.error(error);
    return [];
  }
  return data || [];
}
