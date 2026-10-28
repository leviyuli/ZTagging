/** Serialized atomic state, with a previous generation for recovery. No credentials live here. */
export interface StateIO {
  read(path: string): Promise<string>;
  writeAtomic(path: string, data: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** Native byte reads preserve BOM/encoding when comparing immutable migration backups. */
  readBytes?(path: string): Promise<Uint8Array>;
  /** Copy exact bytes to a new destination; implementations must refuse to overwrite it. */
  copyExact?(source: string, destination: string): Promise<void>;
}

export class AtomicStore<T extends {schemaVersion: number}> {
  private tail: Promise<void> = Promise.resolve();
  recovered = false;
  private io: StateIO;
  private path: string;
  private initial: () => T;
  private validate: (value: unknown) => value is T;
  private migrate?: (value: unknown) => T;
  private canMigrate?: (value: unknown) => boolean;
  migrated = false;
  constructor(io: StateIO, path: string, initial: () => T, validate: (value: unknown) => value is T, migrate?: (value: unknown) => T, canMigrate?: (value: unknown) => boolean) {
    this.io=io;this.path=path;this.initial=initial;this.validate=validate;this.migrate=migrate;this.canMigrate=canMigrate;
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
  private async sameOriginal(source: string, backup: string, original: string): Promise<boolean> {
    if (!this.io.readBytes) return await this.io.read(backup) === original;
    const sourceBytes = await this.io.readBytes(source), backupBytes = await this.io.readBytes(backup);
    return sourceBytes.length === backupBytes.length && sourceBytes.every((byte, index) => byte === backupBytes[index]);
  }
  private async preserveOriginal(source: string, original: string, targetVersion: number): Promise<void> {
    // A different earlier source must keep its own immutable backup, including after a retry.
    for (let suffix = 0; ; suffix++) {
      const backup = `${this.path}.pre-v${targetVersion}${suffix ? `.${suffix}` : ''}.json`;
      if (await this.io.exists(backup)) {
        if (await this.sameOriginal(source, backup, original)) return;
        continue;
      }
      if (this.io.copyExact) await this.io.copyExact(source, backup);
      else await this.writeAtomic(backup, original);
      return;
    }
  }
  async load(): Promise<T> {
    this.recovered = false; this.migrated = false;
    for (const path of [this.path, this.path + '.bak']) {
      if (!await this.io.exists(path)) continue;
      let original: string, parsed: unknown, isLegacy: boolean;
      try {
        original = await this.io.read(path);
        parsed = JSON.parse(original);
        const current = this.validate(parsed);
        const version = (parsed as {schemaVersion?: unknown} | null)?.schemaVersion;
        // Production supplies structural legacy validation. The fallback keeps the generic
        // store compatible with clients that previously supplied only a migration function.
        isLegacy = !current && !!this.migrate && (this.canMigrate ? this.canMigrate(parsed)
          : Number.isInteger(version) && (version as number) > 0 && (version as number) < this.initial().schemaVersion);
        if (!current && !isLegacy) throw new Error('Unsupported or invalid Smart Tags state');
      } catch (error) {
        if (path.endsWith('.bak')) throw new Error('Smart Tags state and backup could not be read. Preserve the files and restore a backup.');
        if (!await this.io.exists(this.path + '.bak')) throw error;
        continue;
      }
      // From here the source is a valid generation. Migration, exact-backup, and write
      // failures must stop, never substitute an older generation from .bak.
      if (isLegacy) await this.preserveOriginal(path, original, this.initial().schemaVersion);
      const value: unknown = this.migrate ? this.migrate(parsed) : parsed;
      if (!this.validate(value)) throw new Error('Migration produced unsupported or invalid Smart Tags state');
      if ((parsed as {schemaVersion?: number})?.schemaVersion !== value.schemaVersion) {
        await this.writeAtomic(this.path, JSON.stringify(value));
        this.migrated = true;
      }
      this.recovered = path.endsWith('.bak');
      return value;
    }
    return this.initial();
  }
  save(value: T): Promise<void> {
    const text = JSON.stringify(value);
    const next = this.tail.catch(()=>{}).then(async () => {
      if (await this.io.exists(this.path)) {
        const old = await this.io.read(this.path);
        let validOld = false;
        try { validOld = this.validate(JSON.parse(old)); } catch { /* Keep the last valid backup for an invalid current generation. */ }
        if (validOld) await this.writeAtomic(this.path + '.bak', old);
      }
      await this.writeAtomic(this.path, text);
    });
    this.tail = next;
    return next;
  }
  async flush() { await this.tail; }
}
