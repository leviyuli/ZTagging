/** Serialized atomic state, with a previous generation for recovery. No credentials live here. */
export interface StateIO {
  read(path: string): Promise<string>;
  writeAtomic(path: string, data: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export class AtomicStore<T extends {schemaVersion: number}> {
  private tail: Promise<void> = Promise.resolve();
  recovered = false;
  private io: StateIO;
  private path: string;
  private initial: () => T;
  private validate: (value: unknown) => value is T;
  private migrate?: (value: unknown) => T;
  migrated = false;
  constructor(io: StateIO, path: string, initial: () => T, validate: (value: unknown) => value is T, migrate?: (value: unknown) => T) {
    this.io=io;this.path=path;this.initial=initial;this.validate=validate;this.migrate=migrate;
  }
  private async writeAtomic(path:string,data:string):Promise<void> {
    for(let attempt=0;;attempt++)try {await this.io.writeAtomic(path,data);return;}
    catch(error) {
      // Windows indexing/sync tools can briefly lock an atomic replacement. Keep the same
      // serialized generation and retry only that transient failure, never disk/schema errors.
      if(attempt>=4||!/NS_ERROR_FILE_ACCESS_DENIED|sharing violation|EBUSY|EPERM/.test(String((error as any)?.message??error)))throw error;
      await new Promise(resolve=>setTimeout(resolve,50*2**attempt));
    }
  }
  async load(): Promise<T> {
    for (const path of [this.path, this.path + '.bak']) {
      if (!await this.io.exists(path)) continue;
      try {
        const original = await this.io.read(path);
        const parsed: unknown = JSON.parse(original);
        const value: unknown = this.migrate ? this.migrate(parsed) : parsed;
        if (!this.validate(value)) throw new Error('Unsupported or invalid Smart Tags state');
        if ((parsed as {schemaVersion?:number})?.schemaVersion !== value.schemaVersion) {
          const backup = this.path + '.pre-v2.json';
          if (!await this.io.exists(backup)) await this.writeAtomic(backup, original);
          await this.writeAtomic(this.path, JSON.stringify(value));
          this.migrated = true;
        }
        this.recovered = path.endsWith('.bak');
        return value;
      } catch (error) {
        if (path.endsWith('.bak')) throw new Error('Smart Tags state and backup could not be read. Preserve the files and restore a backup.');
        if (!await this.io.exists(this.path + '.bak')) throw error;
      }
    }
    return this.initial();
  }
  save(value: T): Promise<void> {
    const text = JSON.stringify(value);
    const next = this.tail.catch(()=>{}).then(async () => {
      if (await this.io.exists(this.path)) {
        const old = await this.io.read(this.path);
        try { if (this.validate(JSON.parse(old))) await this.writeAtomic(this.path + '.bak', old); } catch { /* Keep the last valid backup. */ }
      }
      await this.writeAtomic(this.path, text);
    });
    this.tail = next;
    return next;
  }
  async flush() { await this.tail; }
}
