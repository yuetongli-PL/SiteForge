// @ts-check

export async function createBlockedMediaDownloadReport() {
  return {
    downloads: [],
    queue: [],
    candidates: [],
    expectedMedia: 0,
    skippedMedia: 0,
    skippedCandidates: 0,
    status: 'blocked',
    supported: false,
    blocked: true,
    reason: 'download-layer-removed',
    reasonCode: 'download-layer-removed',
  };
}
