import { Directory, File, Paths } from 'expo-file-system';
import { FileSystemUploadType, uploadAsync } from 'expo-file-system/legacy';

const folder = () => new Directory(Paths.document, 'waiting-photos');

/** Moved somewhere the system will not clear it while it waits for signal. */
export async function keepPhoto(uri: string) {
  const directory = folder();
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  const name = `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}.jpg`;
  const target = new File(directory, name);
  new File(uri).copy(target);
  return target.uri;
}
export async function deletePhoto(uri: string) {
  const file = new File(uri);
  if (file.exists) file.delete();
}
/** Waiting photos, and what the camera and the resizer left in the cache. */
export async function deleteAllPhotos() {
  const directory = folder();
  if (directory.exists) directory.delete();
  for (const item of new Directory(Paths.cache).list()) item.delete();
}
export async function uploadPhoto(url: string, token: string, uri: string) {
  const reply = await uploadAsync(url, uri, {
    httpMethod: 'POST',
    uploadType: FileSystemUploadType.BINARY_CONTENT,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/jpeg' },
  });
  return { status: reply.status, body: reply.body };
}
