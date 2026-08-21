import {
  getStorage,
  ref,
  uploadBytesResumable,
  getDownloadURL,
} from "firebase/storage";
import app from "./firebase";
import { generateId } from "./route-utils";

const storage = getStorage(app);

export interface ImageUploadHandle {
  /** Resolves to the download URL on success, rejects (including on
   * `cancel()`) otherwise. */
  promise: Promise<string>;
  /** Aborts the in-flight transfer. Callers should invoke this from an
   * unmount cleanup so a mid-upload navigation doesn't leave a resumable
   * upload running (or its callbacks firing `setState` on an unmounted
   * component). A no-op if the upload already settled. */
  cancel: () => void;
}

/** Upload with progress via `uploadBytesResumable`; `onProgress` receives a
 * 0–1 fraction. `contentType` is passed explicitly rather than trusting
 * `file.type` — after a canvas downscale the caller already knows the real
 * type, and some browsers report an empty `type` for HEIC.
 *
 * Synchronous (not `async`) so the caller can grab `cancel` before the
 * first `await` — storing it in a ref immediately, with no window where an
 * unmount could race past it. */
function uploadImage(
  path: string,
  file: Blob,
  contentType: string,
  onProgress?: (fraction: number) => void
): ImageUploadHandle {
  const storageRef = ref(storage, path);
  const task = uploadBytesResumable(storageRef, file, { contentType });
  const promise = new Promise<string>((resolve, reject) => {
    task.on(
      "state_changed",
      (snapshot) => {
        if (onProgress && snapshot.totalBytes > 0) {
          onProgress(snapshot.bytesTransferred / snapshot.totalBytes);
        }
      },
      reject,
      () => {
        getDownloadURL(task.snapshot.ref).then(resolve, reject);
      }
    );
  });
  return { promise, cancel: () => task.cancel() };
}

// Path must match storage.rules `match /profiles/{userId}/{photoId}` — a
// fixed `avatar` sub-path means every re-upload overwrites the same object
// instead of leaving orphaned files behind.
export function uploadAvatar(
  userId: string,
  file: Blob,
  contentType: string,
  onProgress?: (fraction: number) => void
): ImageUploadHandle {
  return uploadImage(`profiles/${userId}/avatar`, file, contentType, onProgress);
}

export async function getAvatarUrl(userId: string): Promise<string | null> {
  try {
    const storageRef = ref(storage, `profiles/${userId}/avatar`);
    return await getDownloadURL(storageRef);
  } catch {
    return null;
  }
}

// Primary path, matching storage.rules `match
// /trip-reports/{userId}/{sessionId}/{photoId}`. `reports/{photoId}` (a
// flat match also present in storage.rules) is explicitly documented there
// as a create-only shim kept for older app versions mid-cutover — new
// uploads should use the scoped path. Fall back to it only if `sessionId`
// is unexpectedly unavailable (TripReport.sessionId is nullable in the
// type even though every report created today has one).
export function uploadReportPhoto(
  userId: string,
  sessionId: string | null,
  file: Blob,
  contentType: string,
  onProgress?: (fraction: number) => void
): ImageUploadHandle {
  const path = sessionId
    ? `trip-reports/${userId}/${sessionId}/${generateId()}`
    : `reports/${generateId()}`;
  return uploadImage(path, file, contentType, onProgress);
}
