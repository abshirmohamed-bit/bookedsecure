/** Pure AI routing rules shared by every assistant surface (no I/O). */
export const EXTERNAL_AI_BASE_URL = 'https://api.cheaperinference.com/v1';
export const EXTERNAL_AI_SECRET = 'CHEAPER_INFERENCE_API_KEY';

export type RoutingState = { primary: 'lovable' | 'external'; lovableStandby: boolean; fastModel: string; agentModel: string };
export const DEFAULT_ROUTING: RoutingState = { primary: 'lovable', lovableStandby: true, fastModel: 'grok-code-fast-1', agentModel: 'grok-code-fast-1' };

function statusOf(error: unknown): number | null {
  let current = error;
  for (let i = 0; i < 8 && current && typeof current === 'object'; i++) {
    const e = current as { statusCode?: unknown; status?: unknown; cause?: unknown };
    const s = typeof e.statusCode === 'number' ? e.statusCode : typeof e.status === 'number' ? e.status : null;
    if (s !== null) return s;
    current = e.cause;
  }
  return null;
}

/**
 * A provider may be swapped only for credit exhaustion or an outage.
 * Refusals, access denials (401/403) and bad requests (400/404) never switch.
 */
export function canFailOver(error: unknown): boolean {
  const status = statusOf(error);
  if (status === null) return error instanceof TypeError; // network failure
  return status === 402 || status === 408 || status === 429 || status >= 500;
}

export function normaliseRouting(row: Record<string, unknown> | null | undefined): RoutingState {
  return {
    primary: row?.['primary_provider'] === 'external' ? 'external' : 'lovable',
    lovableStandby: row?.['lovable_standby'] !== false,
    fastModel: typeof row?.['fast_model'] === 'string' && row['fast_model'] ? (row['fast_model'] as string) : DEFAULT_ROUTING.fastModel,
    agentModel: typeof row?.['agent_model'] === 'string' && row['agent_model'] ? (row['agent_model'] as string) : DEFAULT_ROUTING.agentModel,
  };
}
