/** Strict, incremental JSON events. Values and string bodies are never accumulated. */
export type JsonEvent =
  | {type:'object-start'|'object-end'|'array-start'|'array-end'|'string-start'|'string-end'}
  | {type:'key';value:string}
  | {type:'string-chunk';value:string}
  | {type:'scalar';value:null|boolean|number};

export class JsonStreamError extends Error {
  readonly position:number;
  constructor(message:string,position:number){super(`${message} at JSON character ${position}.`);this.position=position;this.name='JsonStreamError';}
}

type Frame={kind:'object';state:'key-or-end'|'key'|'colon'|'value'|'comma-or-end';keys:Set<string>}|{kind:'array';state:'value-or-end'|'value'|'comma-or-end'};
export interface JsonStreamOptions {signal?:AbortSignal;yieldControl?:()=>Promise<void>;maxDepth?:number}

export async function streamJson(source:AsyncIterable<Uint8Array>,receive:(event:JsonEvent)=>Promise<void>,options:JsonStreamOptions={}):Promise<void> {
  const decoder=new TextDecoder('utf-8',{fatal:true}),stack:Frame[]=[];
  let root:'value'|'done'='value',mode:'plain'|'string'|'number'|'literal'='plain',position=0;
  let stringRole:'key'|'value'='value',part='',escape=false,unicode='',unicodeRemaining=0,token='',literal='';
  const fail=(message:string):never=>{throw new JsonStreamError(message,position);};
  const active=()=>{if(options.signal?.aborted)throw options.signal.reason??new Error('JSON import cancelled.');};
  const expectsValue=()=>{const frame=stack.at(-1);return frame?frame.kind==='array'&&(frame.state==='value'||frame.state==='value-or-end')||frame.kind==='object'&&frame.state==='value':root==='value';};
  const complete=()=>{const frame=stack.at(-1);if(frame)frame.state='comma-or-end';else root='done';};
  const emit=async(event:JsonEvent)=>{active();await receive(event);};
  const flushString=async(final=false)=>{
    let output=part;
    if(!final&&output.length&&/[\uD800-\uDBFF]/.test(output.at(-1)!)){part=output.at(-1)!;output=output.slice(0,-1);}else part='';
    if(output)await emit({type:'string-chunk',value:output});
  };
  const append=(value:string)=>{
    part+=value;
    if(stringRole==='key'){if(part.length>16_384)fail('JSON field name exceeds the supported limit');}
    return stringRole==='value'&&part.length>=8192;
  };
  const finishNumber=async()=>{
    if(!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(token))fail('Invalid JSON number');
    const value=Number(token);if(!Number.isFinite(value))fail('JSON number is outside the finite numeric range');
    await emit({type:'scalar',value});token='';mode='plain';complete();
  };
  const decode=(bytes?:Uint8Array,stream=false)=>{try{return decoder.decode(bytes,{stream});}catch{throw new JsonStreamError('Invalid UTF-8 in JSON',position);}};
  const consume=async(text:string)=>{
    for(let index=0;index<text.length;index++){
      const char=text[index];position++;
      if(mode==='string'){
        if(unicodeRemaining){if(!/[0-9a-f]/i.test(char))fail('Invalid JSON Unicode escape');unicode+=char;if(!--unicodeRemaining){if(append(String.fromCharCode(parseInt(unicode,16))))await flushString();unicode='';}continue;}
        if(escape){escape=false;if(char==='u'){unicodeRemaining=4;unicode='';continue;}const escapes:Record<string,string>={'"':'"','\\':'\\','/':'/','b':'\b','f':'\f','n':'\n','r':'\r','t':'\t'};if(!Object.hasOwn(escapes,char))fail('Invalid JSON escape');if(append(escapes[char]))await flushString();continue;}
        if(char==='\\'){escape=true;continue;}
        if(char==='"'){
          if(stringRole==='key'){const frame=stack.at(-1);if(frame?.kind!=='object')fail('Unexpected JSON field');const fields=(frame as Extract<Frame,{kind:'object'}>).keys;if(fields.has(part))fail('Duplicate JSON field');fields.add(part);await emit({type:'key',value:part});part='';frame!.state='colon';}
          else{await flushString(true);await emit({type:'string-end'});complete();}
          mode='plain';continue;
        }
        if(char.charCodeAt(0)<32)fail('Unescaped JSON control character');if(append(char))await flushString();continue;
      }
      if(mode==='number'){
        if(/[0-9eE+\-.]/.test(char)){token+=char;if(token.length>128)fail('JSON number exceeds the supported limit');continue;}
        await finishNumber();
      }else if(mode==='literal'){
        token+=char;if(!literal.startsWith(token))fail('Invalid JSON literal');
        if(token===literal){await emit({type:'scalar',value:literal==='null'?null:literal==='true'});mode='plain';token='';complete();}
        continue;
      }
      if(/\s/.test(char)){if(![' ','\t','\r','\n'].includes(char))fail('Invalid JSON whitespace');continue;}
      const frame=stack.at(-1);
      if(char==='}'||char===']'){
        if(!frame||char==='}'&&frame.kind!=='object'||char===']'&&frame.kind!=='array')fail('Mismatched JSON container');
        if(frame!.state!=='comma-or-end'&&frame!.state!==(frame!.kind==='object'?'key-or-end':'value-or-end'))fail('Incomplete JSON container');
        stack.pop();await emit({type:char==='}'?'object-end':'array-end'});complete();continue;
      }
      if(frame?.state==='comma-or-end'){
        if(char!==',')fail('Expected a JSON comma');frame.state=frame.kind==='object'?'key':'value';continue;
      }
      if(frame?.kind==='object'&&frame.state==='colon'){if(char!==':')fail('Expected a JSON colon');frame.state='value';continue;}
      if(frame?.kind==='object'&&(frame.state==='key'||frame.state==='key-or-end')){
        if(char!=='"')fail('Expected a JSON field name');mode='string';stringRole='key';part='';continue;
      }
      if(!expectsValue())fail('Unexpected JSON value');
      if(char==='{'||char==='['){
        if(stack.length>=(options.maxDepth??512))fail('JSON nesting exceeds the supported limit');
        stack.push(char==='{'?{kind:'object',state:'key-or-end',keys:new Set<string>()}:{kind:'array',state:'value-or-end'});await emit({type:char==='{'?'object-start':'array-start'});continue;
      }
      if(char==='"'){mode='string';stringRole='value';part='';await emit({type:'string-start'});continue;}
      if(char==='-'||/[0-9]/.test(char)){mode='number';token=char;continue;}
      if(char==='t'||char==='f'||char==='n'){mode='literal';literal=char==='t'?'true':char==='f'?'false':'null';token=char;continue;}
      fail('Invalid JSON value');
    }
  };
  for await(const bytes of source){
    active();
    for(let offset=0;offset<bytes.length;offset+=65_536){await consume(decode(bytes.subarray(offset,offset+65_536),true));await options.yieldControl?.();}
  }
  await consume(decode());active();
  if((mode as string)==='number')await finishNumber();
  if((mode as string)!=='plain'||stack.length||(root as string)!=='done')fail('Incomplete JSON document');
}
