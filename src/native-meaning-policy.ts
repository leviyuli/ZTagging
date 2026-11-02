export type NativeTagTreatment='personal'|'scientific';

const PERSONAL_NAMES=new Set(['important','to read','unread','read','reading list','read later','to review','review later','favorite','favorites','favourite','favourites','starred','pinned','urgent','todo','to do','done']);

export function isPersonalNativeTagName(name:string):boolean {
  return PERSONAL_NAMES.has(name.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase());
}

export function validNativeTagTreatments(value:unknown):value is Record<string,NativeTagTreatment> {
  return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.entries(value).every(([name,treatment])=>!!name&&(treatment==='personal'||treatment==='scientific'));
}
