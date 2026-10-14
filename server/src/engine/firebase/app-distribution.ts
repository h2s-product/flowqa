/**
 * Firebase App Distribution REST API (v1): daftar release sebuah aplikasi dan
 * link unduh biner-nya (binaryDownloadUri, berlaku singkat ±1 jam).
 * https://firebase.google.com/docs/reference/app-distribution/rest
 */
import type { FirebaseRelease } from '@flowqa/shared';
import { FirebaseError, type GoogleTokenSource, type ServiceAccountKey } from './google-auth';

export const APP_DISTRIBUTION_API = 'https://firebaseappdistribution.googleapis.com';

interface ApiRelease {
  name: string;
  displayVersion?: string;
  buildVersion?: string;
  releaseNotes?: { text?: string };
  createTime?: string;
  firebaseConsoleUri?: string;
  binaryDownloadUri?: string;
}

export type RawRelease = Omit<FirebaseRelease, 'downloaded' | 'apkPath'> & { downloadUri: string };

const PROJECT_NUMBER = /^\d{4,20}$/;
const APP_ID = /^1:\d{4,20}:android:[0-9a-f]{6,64}$/i;

export function validateTarget(projectNumber: string, appId: string) {
  if (!PROJECT_NUMBER.test(projectNumber))
    throw new FirebaseError(
      'The project number is the number in Firebase → Project settings, e.g. 123456789012.',
    );
  if (!APP_ID.test(appId))
    throw new FirebaseError(
      'The Android App ID looks like 1:123456789012:android:abc123def456 (Project settings → Your apps).',
    );
}

export class AppDistributionClient {
  constructor(
    private readonly tokens: GoogleTokenSource,
    private readonly apiBase = APP_DISTRIBUTION_API,
  ) {}

  private async get<T>(key: ServiceAccountKey, path: string): Promise<T> {
    const token = await this.tokens.token(key);
    const response = await fetch(`${this.apiBase}${path}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    }).catch((error) => {
      throw new FirebaseError(`Could not reach Firebase App Distribution: ${(error as Error).message}`);
    });
    const data = (await response.json().catch(() => ({}))) as T & {
      error?: { message?: string; status?: string };
    };
    if (!response.ok) {
      const reason = data.error?.message ?? `HTTP ${response.status}`;
      throw new FirebaseError(
        response.status === 403
          ? `Permission denied: ${reason} Give the service account the "Firebase App Distribution Admin" role.`
          : response.status === 404
            ? `Not found: ${reason} Check the project number and the App ID.`
            : `Firebase App Distribution answered: ${reason}`,
        response.status,
      );
    }
    return data;
  }

  /** Release terbaru dulu. */
  async releases(
    key: ServiceAccountKey,
    projectNumber: string,
    appId: string,
    pageSize = 20,
  ): Promise<RawRelease[]> {
    validateTarget(projectNumber, appId);
    const data = await this.get<{ releases?: ApiRelease[] }>(
      key,
      `/v1/projects/${projectNumber}/apps/${encodeURIComponent(appId)}/releases?orderBy=${encodeURIComponent('createTime desc')}&pageSize=${pageSize}`,
    );
    return (data.releases ?? [])
      .map((r) => ({
        name: r.name,
        id: r.name.split('/').pop() ?? r.name,
        displayVersion: r.displayVersion ?? '',
        buildVersion: r.buildVersion ?? '',
        releaseNotes: r.releaseNotes?.text ?? '',
        createTime: r.createTime ?? '',
        consoleUri: r.firebaseConsoleUri ?? '',
        downloadUri: r.binaryDownloadUri ?? '',
      }))
      .sort((a, b) => b.createTime.localeCompare(a.createTime));
  }

  /** Unduh biner release (link unduh sudah bertanda tangan; tanpa token). */
  async download(uri: string, maxBytes = 500 * 1024 * 1024): Promise<Buffer> {
    if (!/^https?:\/\//.test(uri))
      throw new FirebaseError(
        'This release has no download link (is it an AAB? Only APK releases can be installed).',
      );
    const response = await fetch(uri, { signal: AbortSignal.timeout(10 * 60_000) }).catch((error) => {
      throw new FirebaseError(`Download failed: ${(error as Error).message}`);
    });
    if (!response.ok)
      throw new FirebaseError(
        `Download failed: HTTP ${response.status}. The link may have expired; try again.`,
      );
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length > maxBytes) throw new FirebaseError('The APK is larger than 500 MB.');
    if (data[0] !== 0x50 || data[1] !== 0x4b) throw new FirebaseError('The downloaded file is not an APK.');
    // AAB juga ZIP, tetapi tidak bisa dipasang langsung.
    if (data.includes('BundleConfig.pb'))
      throw new FirebaseError(
        'This release is an Android App Bundle (AAB). Distribute an APK build to install it on test devices.',
      );
    return data;
  }
}
