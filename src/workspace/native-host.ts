import {ZoteroHost} from '../platform.ts';
import {paperFingerprint} from '../core.ts';
import type {PaperRecord} from '../core.ts';
import type {TagPatch} from '../platform.ts';
import type {MetadataPatch,PaperInputAssessment} from '../paper-recovery.ts';
import type {NativeItemIdentity,NativeLibraryPage} from './indexing.ts';
export type {NativeItemIdentity,NativeLibraryPage} from './indexing.ts';

export interface NativePaperTransport {paper:PaperRecord;lease?:string;fields?:{title?:number;abstract?:number;keywords?:number}}
export type NativeInputSources=PaperInputAssessment&{cachePaths:string[]};
type ScopeLease={scope:string;ids?:number[];maximum?:number;offset:number};
type LibraryLease={maximum:number;offset:number;total:number};
interface HostOptions {host?:ZoteroHost;zotero?:typeof Zotero;exists?:(path:string)=>Promise<boolean>;clock?:()=>number;yield?:()=>Promise<void>;randomId?:()=>string}
const FIELD_CHARS=8192;
const stripHTML=(value:string)=>value.replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim();
/** Called in the worker, after bounded native-field transfers. */
export function normalizeNativePaper(paper:PaperRecord):PaperRecord {paper.title=stripHTML(paper.title);paper.abstract=stripHTML(paper.abstract);paper.fingerprint=paperFingerprint(paper);return paper;}

export class WorkspaceHost {
  readonly host:ZoteroHost;
  private zotero:typeof Zotero;
  private exists:(path:string)=>Promise<boolean>;
  private now:()=>number;
  private yield:()=>Promise<void>;
  private randomId:()=>string;
  private leases=new Map<string,ScopeLease>();
  private libraryLeases=new Map<string,LibraryLease>();
  private papers=new Map<string,PaperRecord>();
  private stopping=false;
  private lastYield:number;
  constructor(options:HostOptions={}){this.host=options.host??new ZoteroHost();this.zotero=options.zotero??Zotero;this.exists=options.exists??(path=>IOUtils.exists(path));this.now=options.clock??(()=>globalThis.performance?.now?.()??Date.now());this.yield=options.yield??(()=>new Promise(resolve=>setTimeout(resolve,0)));this.randomId=options.randomId??(()=>globalThis.crypto?.randomUUID?.()??Services.uuid.generateUUID().toString().slice(1,-1));this.lastYield=this.now();}
  private check(){if(this.stopping)throw new Error('Smart Tags is stopping. Completed changes remain recorded for recovery.');}
  async yieldToUI(){if(this.now()-this.lastYield>=4){await this.yield();this.lastYield=this.now();}this.check();}
  async ids(scope:string,cursor?:string):Promise<{ids:number[];cursor?:string}> {
    this.check();let id=cursor?.split(':')[0],lease=id?this.leases.get(id):undefined;
    if(cursor&&(!lease||lease.scope!==scope||cursor!==id+':'+lease.offset))throw new Error('This paper selection expired. Start the operation again.');
    if(!lease){
      id=this.randomId();lease={scope,offset:0};const pane=this.zotero.getActiveZoteroPane();
      if(scope==='selected'){
        lease.ids=[];for(const item of pane?.getSelectedItems()??[]){if(item.libraryID===this.zotero.Libraries.userLibraryID)lease.ids.push(item.id);await this.yieldToUI();}
      }else if(scope==='collections'){
        const collections=pane?.getSelectedCollections()??[];if(!collections.length)throw new Error('Select at least one collection in Zotero first.');
        const ids=new Set<number>(),visited=new Set<number>();
        type Collection={id:number;loadDataType:(type:string)=>Promise<void>;getChildItems:(...args:boolean[])=>{id:number}[];getChildCollections:(...args:boolean[])=>Collection[]};
        const pending:Collection[]=[...collections];
        while(pending.length){
          const collection=pending.pop()!;if(visited.has(collection.id))continue;visited.add(collection.id);
          await collection.loadDataType('childItems');this.check();await collection.loadDataType('childCollections');this.check();
          for(const item of collection.getChildItems(false,false)){ids.add(item.id);await this.yieldToUI();}
          for(const child of collection.getChildCollections(false)){pending.push(child);await this.yieldToUI();}
        }
        lease.ids=[];for(const itemID of ids){lease.ids.push(itemID);await this.yieldToUI();}
      }else lease.maximum=Number(await this.zotero.DB.valueQueryAsync('SELECT MAX(itemID) FROM items WHERE libraryID=?',[this.zotero.Libraries.userLibraryID])??0);
      this.check();if(this.leases.size>=8)this.leases.delete(this.leases.keys().next().value!);this.leases.set(id,lease);
    }
    const ids:number[]=lease.ids?lease.ids.slice(lease.offset,lease.offset+50):await this.zotero.DB.columnQueryAsync('SELECT itemID FROM items WHERE libraryID=? AND itemID>? AND itemID<=? ORDER BY itemID LIMIT 50',[this.zotero.Libraries.userLibraryID,lease.offset,lease.maximum]);
    this.check();lease.offset=lease.ids?lease.offset+ids.length:Number(ids.at(-1)??lease.offset);
    const more=ids.length===50&&(!lease.ids||lease.offset<lease.ids.length);if(!more)this.leases.delete(id!);
    return {ids,...(more?{cursor:id+':'+lease.offset}:{})};
  }
  private personal(item:any){return item&&!item.deleted&&item.libraryID===this.zotero.Libraries.userLibraryID&&item.isRegularItem?.();}
  async capturePaperScope(scope:'selected'|'collections'):Promise<{itemID:number;paperId:string}[]>{
    this.check();const identities=new Map<number,{itemID:number;paperId:string}>();
    const add=async(item:any)=>{if(this.personal(item)){identities.set(item.id,{itemID:item.id,paperId:`${item.libraryID}:${item.key}`});if(identities.size>10_000)throw new RangeError('Select up to 10,000 papers for one task.');}await this.yieldToUI();};
    if(scope==='selected')for(const item of this.zotero.getActiveZoteroPane()?.getSelectedItems()??[])await add(item);
    else {let cursor:string|undefined;do{const page=await this.ids(scope,cursor);for(const id of page.ids)await add(await this.zotero.Items.getAsync(id));cursor=page.cursor;}while(cursor);}
    return [...identities.values()];
  }
  async libraryPage(cursor?:string):Promise<NativeLibraryPage>{
    this.check();let id=cursor?.split(':')[0],lease=id?this.libraryLeases.get(id):undefined;
    if(cursor&&(!lease||cursor!==id+':'+lease.offset))throw new Error('This library index cursor expired. Start indexing again.');
    const excluded=['note','attachment','annotation'].map(name=>Number(this.zotero.ItemTypes.getID(name)));
    if(excluded.some(value=>!Number.isSafeInteger(value)||value<1))throw new Error('Native regular-item types are unavailable.');
    // These columns and deletedItems are verified against Zotero's userdata.sql.
    const where='i.libraryID=? AND i.itemTypeID NOT IN (?,?,?) AND NOT EXISTS (SELECT 1 FROM deletedItems d WHERE d.itemID=i.itemID)';
    const params=[this.zotero.Libraries.userLibraryID,...excluded];
    if(!lease){
      const rows=await this.zotero.DB.queryAsync('SELECT MAX(i.itemID) AS maximum,COUNT(*) AS total FROM items i WHERE '+where,params);this.check();
      lease={maximum:Number(rows[0]?.maximum??0),offset:0,total:Number(rows[0]?.total??0)};
      if(!Number.isSafeInteger(lease.maximum)||lease.maximum<0||!Number.isSafeInteger(lease.total)||lease.total<0)throw new Error('Native library counts are unavailable.');
      id=this.randomId();if(this.libraryLeases.size>=8)this.libraryLeases.delete(this.libraryLeases.keys().next().value!);this.libraryLeases.set(id,lease);
    }
    const rows=await this.zotero.DB.queryAsync('SELECT i.itemID,i.key,i.dateModified,i.clientDateModified,i.version,i.clientVersion FROM items i WHERE '+where+' AND i.itemID>? AND i.itemID<=? ORDER BY i.itemID LIMIT 50',[...params,lease.offset,lease.maximum]);this.check();
    if(rows.length>50)throw new Error('Native identity reads must be bounded.');
    const items:NativeItemIdentity[]=[];
    for(const row of rows){
      const itemID=Number(row.itemID),key=String(row.key??'');
      if(!Number.isSafeInteger(itemID)||itemID<=lease.offset||itemID>lease.maximum||!key||key.length>128)throw new Error('Native item identity is invalid.');
      const version=JSON.stringify([key,row.dateModified??null,row.clientDateModified??null,row.version??0,row.clientVersion??0]);
      if(version.length>1024)throw new Error('Native item version is invalid.');
      items.push({itemID,paperId:`${this.zotero.Libraries.userLibraryID}:${key}`,version});lease.offset=itemID;await this.yieldToUI();
    }
    const more=rows.length===50&&lease.offset<lease.maximum;if(!more)this.libraryLeases.delete(id!);
    return {items,total:lease.total,...(more?{cursor:id+':'+lease.offset}:{})};
  }
  async read(itemID:number):Promise<NativePaperTransport|null>{
    this.check();const item=await this.zotero.Items.getAsync(itemID);this.check();if(!this.personal(item))return null;
    const source:PaperRecord={id:`${item.libraryID}:${item.key}`,itemID:item.id,libraryID:item.libraryID,key:item.key,title:String(item.getField('title')||''),abstract:String(item.getField('abstractNote')||''),keywords:[],summary:'',concepts:[],fingerprint:''};
    for(const tag of item.getTags()){if(tag.type===1)source.keywords.push(tag.tag);await this.yieldToUI();}
    const paper={...source,keywords:source.keywords},fields:NonNullable<NativePaperTransport['fields']>={};let remaining=FIELD_CHARS;
    for(const field of ['title','abstract'] as const){if(source[field].length>remaining){fields[field]=source[field].length;paper[field]='';}else remaining-=source[field].length;}
    let characters=0;for(const keyword of source.keywords){characters+=keyword.length;await this.yieldToUI();if(characters>remaining)break;}
    if(characters>remaining){fields.keywords=source.keywords.length;paper.keywords=[];}
    if(!Object.keys(fields).length)return {paper};
    if(this.papers.size>=2)throw new Error('Two paper transfers are already in progress. Finish or cancel one first.');
    const lease=this.randomId();this.papers.set(lease,source);return {paper,lease,fields};
  }
  async paperField(lease:string,field:string,offset:number,maxChars=FIELD_CHARS):Promise<string>{
    this.check();const paper=this.papers.get(lease);if(!paper)throw new Error('This paper transfer expired. Read the paper again.');
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(maxChars)||maxChars<1||maxChars>FIELD_CHARS)throw new Error('Paper field reads require bounded offsets and lengths.');
    let value:string|undefined;if(field==='title'||field==='abstract')value=paper[field];else if(/^keyword:\d+$/.test(field))value=paper.keywords[Number(field.slice(8))];
    if(value===undefined)throw new Error('This paper field is unavailable.');await this.yieldToUI();return value.slice(offset,offset+maxChars);
  }
  releasePaper(lease:string){this.papers.delete(lease);}
  async pdfSource(itemID:number):Promise<string|null>{
    this.check();const item=await this.zotero.Items.getAsync(itemID);this.check();if(!this.personal(item))return null;
    for(const id of item.getAttachments()){
      const attachment=await this.zotero.Items.getAsync(id);this.check();if(!attachment||attachment.deleted||attachment.attachmentContentType!=='application/pdf')continue;
      const path=this.zotero.Fulltext.getItemCacheFile(attachment).path;if(await this.exists(path)){this.check();return path;}await this.yieldToUI();
    }
    return null;
  }
  async inputSources(itemID:number,recheck=false):Promise<NativeInputSources>{
    this.check();const item=await this.zotero.Items.getAsync(itemID);this.check();if(!this.personal(item))throw new Error('Item is unavailable or outside your personal library.');
    let attachmentCount=0,localCount=0,readError=false,unknown=false,rechecked=false;const cachePaths:string[]=[];
    for(const id of item.getAttachments()){
      const attachment=await this.zotero.Items.getAsync(id);this.check();if(!attachment||attachment.deleted||attachment.attachmentContentType!=='application/pdf')continue;attachmentCount++;
      try{
        if(typeof attachment.isFileAttachment==='function'&&!attachment.isFileAttachment())continue;
        const local=typeof attachment.fileExists==='function'?await attachment.fileExists():typeof attachment.getFilePathAsync==='function'?!!await attachment.getFilePathAsync():undefined;this.check();
        if(local===false)continue;if(local===undefined){unknown=true;continue;}localCount++;
        if(recheck){if(typeof this.zotero.Fulltext?.indexItems!=='function')throw new Error('Local PDF reindexing is unavailable.');await this.zotero.Fulltext.indexItems([id],{complete:true});this.check();rechecked=true;}
        const path=this.zotero.Fulltext.getItemCacheFile(attachment).path;if(await this.exists(path)){if(cachePaths.length>=50)throw new Error('Too many PDF caches for one paper.');cachePaths.push(path);}
      }catch(error){if(this.stopping)throw error;readError=true;}await this.yieldToUI();
    }
    const status=!attachmentCount?'missing':readError?'readError':localCount?'textUnavailable':unknown?'unknown':'nonlocal';
    return {paperId:`${item.libraryID}:${item.key}`,itemID,checkedAt:new Date().toISOString(),metadata:{title:!!item.getField('title'),abstract:!!item.getField('abstractNote'),keywords:item.getTags().some((tag:{type:number})=>tag.type===1)},pdf:{status,attachmentCount,localCount,characters:0,rechecked},cachePaths};
  }
  private validateFrame(patches:readonly {itemID:number}[]){this.check();if(patches.length>20)throw new Error('Native writes require at most twenty papers per durable chunk.');if(new Set(patches.map(patch=>patch.itemID)).size!==patches.length)throw new Error('A native write chunk cannot change the same paper twice.');}
  async apply(patches:TagPatch[],label:string,ack:(offset:number)=>Promise<void>=async()=>{}):Promise<void>{
    this.validateFrame(patches);if(!patches.length)return;await this.host.apply(patches,label);await ack(patches.length);await this.yieldToUI();
  }
  async applyMetadata(patches:MetadataPatch[],label:string,ack:()=>Promise<void>=async()=>{}):Promise<void>{
    this.validateFrame(patches);if(!patches.length)return;await this.host.applyMetadata(patches,label);await ack();await this.yieldToUI();
  }
  stop(){this.stopping=true;this.leases.clear();this.libraryLeases.clear();this.papers.clear();}
}
