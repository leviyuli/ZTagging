/** Deterministic source-grounded replies; used only by isolated acceptance tests. */
export const fixtureTagName='workspace proton transport';
export function scientificFixtureReply(data){
  if(data.paper&&!data.approvedVocabulary)return {summary:'Experiments measure proton transport through a membrane.',needsPDF:false,concepts:[{name:fixtureTagName,facet:'phenomenon',evidence:[{source:'abstract',text:data.paper.abstract}]}]};
  if(data.selectionPhase==='choosing')return {tags:[{key:'transport',name:fixtureTagName,fullName:fixtureTagName,description:'Proton transport measured in membrane experiments.',facet:'phenomenon',aliases:[],parentKeys:[],relatedKeys:[],routingRefs:(data.conceptRegistry??[]).map(entry=>entry.ref)}],merges:[],excluded:[]};
  if(data.requestedPairs)return {judgements:data.requestedPairs.map(pair=>({pairRef:pair.pairRef,relation:'equivalent',reason:'The supplied scientific quotation directly measures membrane proton transport.'}))};
  if(data.sources&&data.tags)return {judgements:data.sources.map(source=>({tagId:data.tags[0].id,registryId:source.registryId,sourceIds:[source.sourceId],relation:'equivalent',reason:'The supplied scientific quotation directly measures membrane proton transport.'})),outside:[]};
  return undefined;
}
