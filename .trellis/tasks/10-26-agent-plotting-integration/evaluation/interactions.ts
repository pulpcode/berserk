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
/** Ordinary final offers are not blocking; a separate required question still is. */
export function plainQuestion(text:string){
 return (text.match(/[^。！？!?；;\n]+[。！？!?；;]?/g)??[]).find(s=>{
  const required=/(?:必须|仍需|还需|等待).{0,12}(?:确认|回复|提供|选择)|(?:尚缺|缺少).{0,12}(?:信息|数据|坐标|权限)/.test(s);
  if(!required&&(/(?:若|如果|如需|需要的话).*(?:继续|进一步|后续|告诉我|告知)/.test(s)||/^\s*(?:是否需要|要不要)(?:继续|进一步)/.test(s)))return false;
  return /请(?:确认|选择|明确|提供|告知|补充)|[？?]\s*$/.test(s)||required;
 });
}
