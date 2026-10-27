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
  constructor(io: StateIO, path: string, initial: () => T, validate: (value: unknown) => value is T) {
    this.io=io;this.path=path;this.initial=initial;this.validate=validate;
  }
  async load(): Promise<T> {
    for (const path of [this.path, this.path + '.bak']) {
      if (!await this.io.exists(path)) continue;
      try {
        const value: unknown = JSON.parse(await this.io.read(path));
        if (!this.validate(value)) throw new Error('Unsupported or invalid Smart Tags state');
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
        try { if (this.validate(JSON.parse(old))) await this.io.writeAtomic(this.path + '.bak', old); } catch { /* Keep the last valid backup. */ }
      }
      await this.io.writeAtomic(this.path, text);
    });
    this.tail = next;
    return next;
  }
  async flush() { await this.tail; }
}
