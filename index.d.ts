/**
 * Public API for `fixloop`. Internal CLI modules are not part of the contract.
 */

export type TriageLabel = 'product_regression' | 'test_defect' | 'flake' | 'passed';

export interface TriageResult {
  label: TriageLabel;
  reason?: string;
  confidence?: number;
  comment?: string;
}

export interface OracleFailure {
  title?: string;
  file?: string;
  message?: string;
  stack?: string;
  remark?: string;
  retries?: number;
  passedOnRetry?: boolean;
}

export interface OracleResult {
  outcome: 'passed' | 'failed' | 'error';
  firstFailure?: OracleFailure | null;
  rawSummary?: string;
}

export const TEST_DEFECT_COMMENT: 'update the test, I will not.';

export function triageFailure(
  oracleResult: OracleResult,
  opts?: { healTarget?: string | string[] },
): TriageResult;

export function runPipeline(opts: {
  repoRoot?: string;
  config?: object;
  enableHeal?: boolean;
  targetOverride?: string;
  log?: (msg: string) => void;
}): Promise<{
  passed: boolean;
  verified: boolean;
  triage: TriageResult;
  healCount: number;
  lastResult?: OracleResult;
}>;

export function applyUnifiedDiff(original: string, diffText: string): string;
export function redactSecrets(text: string, extra?: string[]): string;
export function assertSafeApiUrl(url: string): string;
export function assertHealPathAllowed(
  repoRoot: string,
  filePath: string,
  allowlist?: string[],
  denylist?: string[],
  healTarget?: string | string[],
): { abs: string; rel: string };
