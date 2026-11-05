// Web build, for browser tests only: notes what would have opened on a phone.
export function openLink(url: string) {
  const host = globalThis as unknown as { __staffOpened?: string[] };
  host.__staffOpened = [...(host.__staffOpened ?? []), url];
}
