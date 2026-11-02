import {DatabaseSync} from 'node:sqlite';
import type {SqlPort,SqlValue} from '../src/workspace/storage-contract.ts';

export function memorySql() {
  const database=new DatabaseSync(':memory:');
  let transaction=false,closed=false;
  const statements:{sql:string;bindings:number}[]=[];
  let failure:((sql:string,parameters:SqlValue[])=>boolean)|undefined;
  const check=(sql:string,parameters:SqlValue[])=>{if(closed)throw new Error('Test database is closed.');if(failure?.(sql,parameters))throw new Error('Synthetic SQL failure');};
  const port:SqlPort={
    async query(sql,parameters=[]){check(sql,parameters);statements.push({sql,bindings:1});return database.prepare(sql).all(...parameters) as Record<string,unknown>[];},
    async batch(sql,bindings){statements.push({sql,bindings:bindings.length});const statement=database.prepare(sql);for(const parameters of bindings){check(sql,parameters);statement.run(...parameters);}},
    async transaction<T>(operation:()=>Promise<T>){if(transaction)throw new Error('Nested transaction');transaction=true;database.exec('BEGIN IMMEDIATE');try{const result=await operation();database.exec('COMMIT');return result;}catch(error){database.exec('ROLLBACK');throw error;}finally{transaction=false;}},
    async close(){closed=true;database.close();},
  };
  return {port,database,statements,fail(predicate?:typeof failure){failure=predicate;}};
}
