import type { PaperRecord } from './core.ts';
import { paperFingerprint } from './core.ts';
import type { TagDefinition } from './core.ts';
import type { ConceptFilter } from './concept-filter.ts';
import { buildConceptSearch } from './native-filter.ts';

export interface NativeTag { tag: string; type: number }
export interface TagPatch { paperId: string; itemID: number; before: NativeTag[]; after: NativeTag[] }
export interface LibraryHost {
  list(scope: string): Promise<PaperRecord[]>;
  read(itemID: number): Promise<PaperRecord | null>;
  readTags(itemID: number): Promise<NativeTag[]>;
  pdfText(itemID: number): Promise<string>;
  apply(patches: TagPatch[], label: string): Promise<void>;
  show(itemID: number): Promise<void>;
  saveSearch(name: string, tags: string[]): Promise<void>;
  saveConceptSearch?(name:string,filter:ConceptFilter,definitions:TagDefinition[]):Promise<void>;
}

function stripHTML(value: string): string {
  return value.replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim();
}

export class ZoteroHost implements LibraryHost {
  mutating = new Set<number>();
  private personal(item: any) { return item && item.isRegularItem() && !item.deleted && item.libraryID === Zotero.Libraries.userLibraryID; }
  private record(item: any): PaperRecord {
    const paper: PaperRecord = {
      id: `${item.libraryID}:${item.key}`, itemID: item.id, libraryID: item.libraryID, key: item.key,
      title: stripHTML(item.getField('title') || ''), abstract: stripHTML(item.getField('abstractNote') || ''),
      keywords: item.getTags().filter((t: NativeTag) => t.type === 1).map((t: NativeTag) => t.tag),
      summary: '', concepts: [], fingerprint: ''
    };
    paper.fingerprint = paperFingerprint(paper);
    return paper;
  }
  async read(itemID: number) {
    const item = await Zotero.Items.getAsync(itemID);
    return this.personal(item) ? this.record(item) : null;
  }
  async list(scope: string) {
    await Zotero.Libraries.get?.(Zotero.Libraries.userLibraryID)?.waitForDataLoad?.('item');
    const pane = Zotero.getActiveZoteroPane();
    let items: any[];
    if (scope === 'selected') items = pane?.getSelectedItems() || [];
    else if (scope === 'collections') {
      const collections = pane?.getSelectedCollections() || [];
      if (!collections.length) throw new Error('Select at least one collection in Zotero first.');
      const collected: any[] = [];
      const visited=new Set<number>();
      const visit = async (collection: any) => {
        if(visited.has(collection.id))return;visited.add(collection.id);
        await collection.loadDataType('childItems');
        await collection.loadDataType('childCollections');
        collected.push(...collection.getChildItems(false, false));
        for (const child of collection.getChildCollections(false)) await visit(child);
      };
      for (const collection of collections) await visit(collection);
      items = collected;
    } else items = await Zotero.Items.getAll(Zotero.Libraries.userLibraryID, true, false);
    items = [...new Map(items.filter(item=>this.personal(item)).map(item=>[item.id,item])).values()];
    const records = items.map(item=>this.record(item)).sort((a,b)=>a.id.localeCompare(b.id));
    if (scope !== 'pilot' || records.length <= 50) return records;
    // Evenly sample titles across the complete library, then keep deterministic item identities.
    const sorted = records.sort((a,b)=>a.title.localeCompare(b.title));
    return Array.from({length:50},(_,i)=>sorted[Math.floor(i*sorted.length/50)]);
  }
  async readTags(itemID: number): Promise<NativeTag[]> {
    const item = await Zotero.Items.getAsync(itemID);
    if (!this.personal(item)) throw new Error('Item is unavailable or outside your personal library.');
    return item.getTags().map((tag: NativeTag)=>({tag:tag.tag,type:tag.type || 0}));
  }
  async pdfText(itemID: number) {
    const item = await Zotero.Items.getAsync(itemID);
    if (!this.personal(item)) return '';
    const attachmentIDs = item.getAttachments();
    for (const id of attachmentIDs) {
      const attachment = await Zotero.Items.getAsync(id);
      if (attachment.attachmentContentType !== 'application/pdf') continue;
      try { const text = await attachment.attachmentText; if (text?.trim()) return text; } catch { /* Report an evidence gap in the controller. */ }
    }
    return '';
  }
  async apply(patches: TagPatch[], _label: string) {
    for (const patch of patches) this.mutating.add(patch.itemID);
    try {
      await Zotero.DB.executeTransaction(async () => {
        Zotero.UndoHistory.stageAction('smart-tags-undo');
        for (const patch of patches) {
          const item = await Zotero.Items.getAsync(patch.itemID);
          if (!this.personal(item)) throw new Error('A paper is no longer available. Refresh the preview.');
          const current = item.getTags().map((t:NativeTag)=>({tag:t.tag,type:t.type||0}));
          if (!sameTags(current, patch.before)) throw new Error('Tags changed after the preview. Refresh before applying.');
          item.setTags(patch.after);
          await item.save();
        }
      });
    } finally { for (const patch of patches) this.mutating.delete(patch.itemID); }
  }
  async show(itemID: number) {
    const pane = Zotero.getActiveZoteroPane();
    await pane.selectItem(itemID);
    Zotero.getMainWindow()?.focus();
  }
  async saveSearch(name: string, tags: string[]) {
    if (!name.trim() || !tags.length) throw new Error('Give this tag combination a name and select at least one tag.');
    const search = new Zotero.Search();
    search.libraryID = Zotero.Libraries.userLibraryID;
    search.name = name.trim();
    search.addCondition('joinMode','all');
    search.addCondition('itemType','isNot','attachment');
    search.addCondition('itemType','isNot','note');
    for (const tag of tags) search.addCondition('tag','is',tag);
    await search.saveTx();
  }
  async saveConceptSearch(name:string,filter:ConceptFilter,definitions:TagDefinition[]) {
    if(!name.trim()||!filter.selections.length)throw new Error('Name the search and select at least one concept.');
    const libraryID=Zotero.Libraries.userLibraryID;
    const names=(await Zotero.Tags.getAll(libraryID)).map((tag:any)=>tag.tag);
    const search=buildConceptSearch(definitions,filter,libraryID,names);
    search.name=name.trim();await search.saveTx();
  }
}

export function sameTags(a: NativeTag[], b: NativeTag[]) {
  const order = (tags:NativeTag[])=>JSON.stringify(tags.map(t=>[t.tag,t.type||0]).sort((x,y)=>String(x[0]).localeCompare(String(y[0]))));
  return order(a) === order(b);
}

export class SecureCredentials {
  private memory = new Map<string,string>();
  sessionOnly = false;
  private origin = 'chrome://smart-tags';
  private realm = 'Smart Tags credentials';
  private logins() { return Services.logins.findLogins(this.origin, null, this.realm); }
  async load(key:string) {
    if (this.memory.has(key)) return this.memory.get(key)!;
    const login = this.logins().find((record:any)=>record.username===key);
    if (!login) return null;
    if (!Zotero.OSKeyStore.isEncrypted(login.password)) throw new Error('Smart Tags refused an unencrypted saved credential. Remove and reconnect this account.');
    return await Zotero.OSKeyStore.decrypt(login.password);
  }
  async save(key:string,value:string) {
    this.memory.set(key,value);
    try {
      const encrypted = await Zotero.OSKeyStore.encrypt(value);
      const login = Cc['@mozilla.org/login-manager/loginInfo;1'].createInstance(Ci.nsILoginInfo);
      login.init(this.origin, null, this.realm, key, encrypted, '', '');
      const existing = this.logins().find((record:any)=>record.username===key);
      if (existing) Services.logins.modifyLogin(existing, login);
      else await Services.logins.addLoginAsync(login);
    } catch { this.sessionOnly = true; await this.removePersisted(key); }
  }
  private async removePersisted(key:string) {
    for (const login of this.logins().filter((record:any)=>record.username===key)) Services.logins.removeLogin(login);
  }
  async remove(key:string) { this.memory.delete(key); await this.removePersisted(key); }
  clearMemory() { this.memory.clear(); }
}

export async function registerOAuthCallback(path: string, handler: (query:Record<string,string>)=>Promise<{status:number;body:string}>) {
  if (!Zotero.Server.port) await Zotero.Server.init();
  if (!Zotero.Server.port) throw new Error('Enable Zotero’s local HTTP server before signing in.');
  if (Zotero.Server.Endpoints[path]) throw new Error('An authentication callback is already active.');
  const Endpoint = function() {};
  Endpoint.prototype = {
    supportedMethods: ['GET'], allowRequestsFromUnsafeWebContent: true, permitBookmarklet: false,
    async init(request: {searchParams:URLSearchParams}) {
      const result = await handler(Object.fromEntries(request.searchParams.entries()));
      return [result.status, {'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}, result.body];
    }
  };
  Zotero.Server.Endpoints[path] = Endpoint;
  return { port: Zotero.Server.port as number, dispose() { if (Zotero.Server.Endpoints[path] === Endpoint) delete Zotero.Server.Endpoints[path]; } };
}

export async function chooseJSONFile(mode:'open'|'save', filename='smart-tags-vocabulary.json'):Promise<string|null> {
  const {FilePicker} = ChromeUtils.importESModule('chrome://zotero/content/modules/filePicker.mjs');
  const picker = new FilePicker();
  picker.init(Zotero.getMainWindow(), mode==='open'?'Import vocabulary':'Export vocabulary', mode==='open'?picker.modeOpen:picker.modeSave);
  picker.defaultString = filename;
  picker.appendFilter('JSON','*.json');
  const result = await picker.show();
  return result===picker.returnCancel ? null : picker.file;
}
