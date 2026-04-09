import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import app from "./firebase";

const storage = getStorage(app);

export async function uploadAvatar(
  userId: string,
  file: File
): Promise<string> {
  const storageRef = ref(storage, `avatars/${userId}`);
  await uploadBytes(storageRef, file);
  return getDownloadURL(storageRef);
}

export async function getAvatarUrl(
  userId: string
): Promise<string | null> {
  try {
    const storageRef = ref(storage, `avatars/${userId}`);
    return await getDownloadURL(storageRef);
  } catch {
    return null;
  }
}
