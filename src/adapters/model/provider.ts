export type ModelRequest =
  | { purpose: 'extract'; text: string; chunkId: string }
  | { purpose: 'extract-repair'; text: string; chunkId: string; error: string }
  | { purpose: 'explain'; findings: { id: string; text: string }[] };

// Return raw text so Evidence can validate and repair malformed replies.
// The signal aborts the call when the request deadline is reached.
export interface ModelProvider {
  call(request: ModelRequest, signal?: AbortSignal): Promise<string>;
}
