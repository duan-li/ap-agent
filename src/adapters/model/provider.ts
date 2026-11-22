export type ModelRequest =
  | { purpose: 'extract' | 'extract-repair'; text: string; chunkId: string }
  | { purpose: 'explain'; findings: { id: string; text: string }[] };

// Return raw text so Evidence can validate and repair malformed replies.
export interface ModelProvider {
  call(request: ModelRequest): Promise<string>;
}
