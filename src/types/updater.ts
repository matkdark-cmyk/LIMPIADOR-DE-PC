export interface UpdateCheckResult {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseTitle: string;
  releaseNotes: string;
  publishedAt: string | null;
  releaseUrl: string;
  downloadUrl: string | null;
  assetName: string | null;
  assetSizeBytes: number;
  checksumsUrl: string | null;
  isPortablePackage: boolean;
  portableFallbackUrl?: string | null;
  portableFallbackName?: string | null;
}

export interface UpdateProgressEvent {
  stage: 'downloading' | 'verifying' | 'installing' | 'error' | string;
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
  message: string;
}

export interface InstallUpdateRequest {
  version: string;
  downloadUrl: string;
  assetName: string;
  checksumsUrl: string | null;
  isPortablePackage: boolean;
  portableFallbackUrl?: string | null;
  portableFallbackName?: string | null;
}
