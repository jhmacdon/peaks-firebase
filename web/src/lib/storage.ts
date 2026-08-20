import {
  getStorage,
  ref,
  uploadBytesResumable,
  getDownloadURL,
} from "firebase/storage";
import app from "./firebase";
import { generateId } from "./route-utils";

const storage = getStorage(app);

/** Upload with progress via `uploadBytesResumable`; `onProgress` receives a
 * 0–1 fraction. `contentType` is passed explicitly rather than trusting
 * `file.type` — after a canvas downscale the caller already knows the real
 * type, and some browsers report an empty `type` for HEIC. */
async function uploadImage(
  path: string,
  file: Blob,
  contentType: string,
  onProgress?: (fraction: number) => void
): Promise<string> {
  const storageRef = ref(storage, path);
  return new Promise((resolve, reject) => {
    const task = uploadBytesResumable(storageRef, file, { contentType });
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
}

// Path must match storage.rules `match /profiles/{userId}/{photoId}` — a
// fixed `avatar` sub-path means every re-upload overwrites the same object
// instead of leaving orphaned files behind.
export async function uploadAvatar(
  userId: string,
  file: Blob,
  contentType: string,
  onProgress?: (fraction: number) => void
): Promise<string> {
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
export async function uploadReportPhoto(
  userId: string,
  sessionId: string | null,
  file: Blob,
  contentType: string,
  onProgress?: (fraction: number) => void
): Promise<string> {
  const path = sessionId
    ? `trip-reports/${userId}/${sessionId}/${generateId()}`
    : `reports/${generateId()}`;
  return uploadImage(path, file, contentType, onProgress);
}
