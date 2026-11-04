// Awards shown in the app's "Awards & recognition" section. Each entry must copy the exact
// wording, issuer and year printed on a certificate the family has supplied and approved
// (docs/FAMILY_CONTENT_CHECKLIST.md). The section stays hidden while this list is empty.
export type Award = { title: string; issuer: string; year: string };
export const awards: Award[] = [];
