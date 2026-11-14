import type { ExpertTrialRecord } from './capability-management';
import type { SessionSnapshot } from './index';
/** Only explicitly provided synthetic/de-identified UTF-8 samples enter trials. */
export interface ExpertTrialFile { name: string; content: string }
export interface ExpertTrialToolCall { toolCallId: string; name: string; status: 'running' | 'completed'; output?: string; isError?: boolean }
export interface ExpertTrialRunView {
  trial: ExpertTrialRecord; snapshot?: SessionSnapshot; calls: ExpertTrialToolCall[];
  environment: { sources: 'synthetic-fixtures'; businessWrites: false; fileEnvironmentAvailable: boolean; model: string; runtime: string };
}
