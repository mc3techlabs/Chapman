import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

/**
 * Best-effort audit trail for critical actions (submit/approve/return,
 * reviewer provisioning, chapter imports) — separate from approval_actions,
 * which already covers the DD/RVP/ED approve-or-return decisions
 * specifically. Never throws: a logging failure shouldn't block the real
 * action it's describing.
 */
export async function logAudit(
  supabase: Client,
  params: {
    actorProfileId: string | null;
    entityType: string;
    entityId?: string | null;
    action: string;
    metadata?: Record<string, unknown>;
  }
) {
  try {
    await supabase.from("audit_log").insert({
      actor_profile_id: params.actorProfileId,
      entity_type: params.entityType,
      entity_id: params.entityId ?? null,
      action: params.action,
      metadata_json: params.metadata ?? {},
    });
  } catch (err) {
    console.error("[audit_log] insert failed:", err);
  }
}
