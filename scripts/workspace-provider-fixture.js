/** TEST ONLY. Installed before the isolated command worker creates its provider. */
export function installWorkspaceProviderFixture(config){
  if(!config?.reportPath)throw new Error('The isolated provider fixture needs a report path.');
  const model=config.model??'workspace-native-fixture';
  const empty=()=>({schemaVersion:1,total:0,models:0,connection:0,assignments:0,blocked:0,requestIds:[]});
  let report=empty(),tail=Promise.resolve();
  const ready=(async()=>{
    if(await IOUtils.exists(config.reportPath)){
      const stat=await IOUtils.stat(config.reportPath);if(stat.size>64*1024)throw new Error('The provider fixture report is unexpectedly large.');
      const saved=JSON.parse(await IOUtils.readUTF8(config.reportPath));
      if(saved.schemaVersion!==1||!['total','models','connection','assignments','blocked'].every(key=>Number.isSafeInteger(saved[key])&&saved[key]>=0)||!Array.isArray(saved.requestIds)||saved.requestIds.some(id=>typeof id!=='string'||!/^workspace-fixture-\d+$/.test(id)))throw new Error('The provider fixture report is invalid.');
      report={schemaVersion:1,...Object.fromEntries(['total','models','connection','assignments','blocked'].map(key=>[key,saved[key]])),requestIds:saved.requestIds.slice(-2048)};
    }
  })();
  const persist=()=>{const body=JSON.stringify(report);tail=tail.then(()=>IOUtils.writeUTF8(config.reportPath,body,{tmpPath:config.reportPath+'.tmp',flush:true}));return tail;};
  const blocked=async()=>{report.blocked++;await persist();throw new Error('The isolated Workspace provider fixture blocks this network request.');};
  const fetch=async(input,options={})=>{
    await ready;let url;try{url=new URL(typeof input==='string'?input:input.url);}catch{return blocked();}
    if(url.origin!=='https://api.openai.com'||url.username||url.password||url.search||url.hash)return blocked();
    const method=String(options.method??'GET').toUpperCase();
    if(method==='GET'&&url.pathname==='/v1/models'){
      report.models++;report.total++;await persist();
      return new Response(JSON.stringify({data:[{id:model}]}),{status:200,headers:{'Content-Type':'application/json'}});
    }
    if(method!=='POST'||url.pathname!=='/v1/responses'||typeof options.body!=='string')return blocked();
    const body=JSON.parse(options.body);if(body.model!==model||body.stream!==true)return blocked();
    const prompt=(body.input??[]).map(message=>typeof message.content==='string'?message.content:Array.isArray(message.content)?message.content.map(part=>part.text??'').join(''):'').join('\n');
    const marker='INPUT_DATA_JSON:',position=prompt.lastIndexOf(marker);let value,unknownOutcome=false;
    if(position<0){if(prompt.trim()!=='Verify the Smart Tags connection.')return blocked();report.connection++;value={ok:true};}
    else{
      const data=JSON.parse(prompt.slice(position+marker.length));
      if(!data.paper||typeof data.paper.abstract!=='string'||!Array.isArray(data.approvedVocabulary))return blocked();
      const uncertain=/\buncertain\b/i.test(data.paper.title??'');
      unknownOutcome=/\bunknown outcome\b/i.test(data.paper.title??'');
      value={summary:'The supplied abstract reports membrane proton-transport experiments.',concepts:['proton transport'],needsPDF:false,newTagCandidates:[],suggestions:data.approvedVocabulary.map(tag=>({tagId:tag.id,reason:uncertain?'The abstract leaves the transport contribution uncertain.':'The supplied experiment directly measures proton transport.',confidence:uncertain?'medium':'high',match:'substantive',evidence:[{source:'abstract',text:data.paper.abstract}]}))};report.assignments++;
    }
    const requestId='workspace-fixture-'+(++report.total);report.requestIds.push(requestId);report.requestIds=report.requestIds.slice(-2048);await persist();
    if(unknownOutcome)throw new TypeError('The isolated provider fixture lost its connection after dispatch.');
    const text=JSON.stringify(value),events=[{type:'response.output_text.delta',delta:text},{type:'response.completed',response:{id:requestId,status:'completed',usage:{input_tokens:100,output_tokens:100}}}];
    const bytes=new TextEncoder().encode(events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''));
    return new Response(new ReadableStream({start(controller){for(let offset=0;offset<bytes.length;offset+=193)controller.enqueue(bytes.slice(offset,offset+193));controller.close();}}),{status:200,headers:{'Content-Type':'text/event-stream','x-request-id':requestId}});
  };
  globalThis.fetch=fetch;
  return {ready};
}
