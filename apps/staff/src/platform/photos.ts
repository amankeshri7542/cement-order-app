// Web build, for browser tests only. Photos are small data addresses, so they live in the queue.
export const keepPhoto = async (uri: string) => uri;
export const deletePhoto = async (_uri: string) => {};
export const deleteAllPhotos = async () => {};
export async function uploadPhoto(url: string, token: string, uri: string) {
  const blob = await (await fetch(uri)).blob();
  const reply = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/jpeg' },
    body: blob,
  });
  return { status: reply.status, body: await reply.text() };
}
