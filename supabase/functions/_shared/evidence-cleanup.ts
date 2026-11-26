// Each item is durably claimed before calling the supported Storage API. SQL finish
// verifies the object is gone, and only then clears the exact registration reference.
export type EvidenceClaim = { id: string; path: string; lease: string };
export interface EvidenceCleanupPort {
  claim(): Promise<EvidenceClaim | null>;
  remove(path: string): Promise<boolean>;
  finish(claim: EvidenceClaim, error: string | null): Promise<void>;
}

export async function cleanupEvidence(port: EvidenceCleanupPort, limit = 20) {
  let removed = 0, failed = 0;
  for (let i = 0; i < limit; i++) {
    const claim = await port.claim();
    if (!claim) break;
    let failure: string | null = null;
    try {
      if (!(await port.remove(claim.path))) failure = 'storage_delete_failed';
    } catch {
      // A lost response is never success; retry and reconcile with Storage later.
      failure = 'storage_delete_uncertain';
    }
    await port.finish(claim, failure);
    if (failure) failed++; else removed++;
  }
  return { removed, failed };
}

export function sameSecret(actual: string, expected: string) {
  // Length is not confidential, but compare every byte for equal-length inputs.
  if (actual.length !== expected.length || expected.length < 32) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0;
}
