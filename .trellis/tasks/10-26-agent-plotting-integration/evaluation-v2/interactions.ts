import type {Interaction,InteractionResponse} from '../../../../experiments/harness-lab/src/contracts/index.js';
import type {Prepared} from './cases.js';
/** Only answer narrow expected clarification. All other interaction needs explicit review. */
export function replyFor(p:Prepared,text:string,turn:number):string|undefined {
 if(/发布|采用|删除|执行命令|shell|bash|密钥|账号|发送|上传|下载|批准|授权/i.test(text))return undefined;
 if(/覆盖/.test(text)&&!(p.caseId==='C08'&&/方向|角度/.test(text)&&!/覆盖/.test(text.replace(/覆盖(?:为|成)?\s*90\s*°?/g,''))&&!/全部|所有|整个/.test(text)))return undefined;
 if(p.caseId==='C02'&&/车型|类型|哪种|哪类|具体|水罐|泡沫/.test(text))return '水罐消防车';
 if(p.caseId==='C08'&&/方向|角度|90|180|备注|并发|变化/.test(text))return '方向仍改90°，保留最新备注';
 // Repeating original wording cannot add permissions, new facts or tool hints.
 if(/草稿|来源|图层|固定|基点|引用|范围/.test(text))return p.prompts[turn];
 return undefined;
}
export function clarificationResponse(p:Prepared,item:Interaction,used:boolean,turn:number):InteractionResponse|undefined{
 if(used||item.kind!=='question'||item.questions.length!==1)return undefined;const q=item.questions[0],reply=replyFor(p,[q.prompt,...(q.options??[]).map(o=>o.label+' '+(o.description??''))].join(' '),turn);
 return reply?{requestId:item.requestId,kind:'question',action:'answer',answers:[{questionId:q.id,text:reply}]}:undefined;
}
export interface EndingAssessment {kind:'finished'|'needs_reply'|'needs_review';reason:string;question?:string}
/** A conservative protocol classifier, not a completion or factual-correctness judge.
 * Conditional offers never authorize another operation. Ambiguous questions stay unresolved.
 */
export function assessEnding(text:string):EndingAssessment {
 if(!text.trim())return {kind:'needs_review',reason:'empty_assistant_ending'};
 let optionalSection=false,uncertain:string|undefined;
 for(const sentence of text.match(/[^。！？!?；;\n]+[。！？!?；;]?/g)??[]){
  if(/可选(?:做法|方案|建议)|替代(?:做法|方案|建议)/.test(sentence))optionalSection=true;
  const explicitBlock=/(?:必须|仍需|还需|还需要|等待|尚缺|缺少|还缺).{0,18}(?:确认|回复|提供|选择|信息|数据|坐标|权限)|(?:完成|继续)(?:本次|这次|当前).{0,18}请|(?:确认|回复|提供|选择).{0,12}(?:后才能|后才可)/.test(sentence);
  const inputRequest=/请(?:您|你)?(?:先)?(?:确认|选择|明确|提供|告知|补充|指明|告诉|回复|回答)/.test(sentence);
  const asks=inputRequest||/^\s*(?:[-*]|\d+[.)、])?\s*请|[？?]\s*$/.test(sentence);
  if(explicitBlock)return {kind:'needs_reply',reason:'explicit_current_dependency',question:sentence};
  if(!asks)continue;
  const conditional=/(?:若|如果|如需)|(?:^|[，,])\s*如|需要.{0,24}(?:的话|时)[，,]/.test(sentence);
  const remaining=/(?:尚未|还未|还没|仍未|未完成|剩余|用户要求|您要求|你要求|本次|这次|当前)/.test(sentence);
  if(remaining)return {kind:'needs_reply',reason:'current_task_question',question:sentence};
  if(conditional){
   const laterOffer=/后续|额外|另行|进一步/.test(sentence)&&!/请(?:您|你)?(?:先)?(?:提供|选择|补充)|完成|才能/.test(sentence);
   if(!laterOffer)uncertain??=sentence;
   continue;
  }
  if(optionalSection){uncertain??=sentence;continue;}
  if(inputRequest)return {kind:'needs_reply',reason:'direct_input_request',question:sentence};
  uncertain??=sentence;
 }
 return uncertain?{kind:'needs_review',reason:'question_scope_uncertain',question:uncertain}:{kind:'finished',reason:'no_blocking_request_detected'};
}
