import {
  createResultDatasetRef, resultDatasetMaxBytes, resultDatasetReceipt,
  type ResultDatasetReceipt,
} from '../contracts/result-dataset.js';
import { hashContent, parseJsonStrict } from '../resources/files.js';

type ResultScope = Pick<ResultDatasetReceipt, 'sessionId' | 'requestId' | 'toolCallId'>;

function modelResult(receipt: ResultDatasetReceipt) {
  const { columns, rows } = receipt.dataset;
  return JSON.stringify({ format: 'result-dataset.receipt.v1', resultRef: receipt.resultRef, columns, rowCount: rows.length });
}

/** Only one complete, explicitly formatted command result can become a dataset. */
export function datasetBashResult(bytes: Uint8Array, scope: ResultScope, fullOutputPath: string) {
  if (!bytes.length || bytes.length > resultDatasetMaxBytes) return;
  let receipt: ResultDatasetReceipt | undefined;
  try {
    const output = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!output.trimStart().startsWith('{')) return;
    const dataset = parseJsonStrict(output);
    receipt = resultDatasetReceipt({ ...scope, resultRef: createResultDatasetRef(scope.requestId, scope.toolCallId), dataset });
  } catch { return; }
  if (!receipt) return;
  return {
    content: [{ type: 'text' as const, text: modelResult(receipt) }],
    details: { resultDataset: receipt, resultDatasetDigest: hashContent(JSON.stringify(receipt.dataset)), fullOutputPath },
  };
}

/** Verify the payload against the same successful native command and compact receipt. */
export function extractBashDataset(details: unknown, isError: boolean, text: string, scope: ResultScope) {
  if (isError || !details || typeof details !== 'object' || !('resultDataset' in details)
    || !('resultDatasetDigest' in details) || !('executionStarted' in details) || details.executionStarted !== true) return;
  const receipt = resultDatasetReceipt(details.resultDataset, scope);
  if (!receipt || details.resultDatasetDigest !== hashContent(JSON.stringify(receipt.dataset)) || text !== modelResult(receipt)) return;
  return receipt;
}
