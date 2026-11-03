import { Type } from 'typebox';
export const calculationSchema=Type.Object({
  operation:Type.Union(['minutes_between','add_minutes','interval_overlap','compare','add','subtract'].map(v=>Type.Literal(v))),
  values:Type.Array(Type.Union([Type.Number(),Type.String({maxLength:100})]),{minItems:2,maxItems:4}),
  unit:Type.String({minLength:1,maxLength:30}),
  evidence:Type.Array(Type.Object({id:Type.String({minLength:1,maxLength:200}),quote:Type.String({minLength:1,maxLength:4000})},{additionalProperties:false}),{minItems:1,maxItems:8})
},{additionalProperties:false});
export interface CalculationInput {operation:string;values:(number|string)[];unit:string;evidence:{id:string;quote:string}[]}
export function calculate(input:CalculationInput){
  const {operation,values,unit}=input;
  const date=(v:number|string)=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v)||!Number.isFinite(Date.parse(v)))throw new Error('时间必须含日期和明确时区，不能用系统时间补齐。');const day=v.slice(0,10),hours=Number(v.slice(11,13)),minutes=Number(v.slice(14,16)),seconds=Number(v.slice(17,19));if(new Date(`${day}T00:00:00Z`).toISOString().slice(0,10)!==day||hours>23||minutes>59||seconds>59)throw new Error('无效日历时间。');return Date.parse(v);};
  const time=(v:number|string)=>typeof v==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v)?(Number(v.slice(0,2))*60+Number(v.slice(3)))*60000:date(v);
  const clocks=values.filter(v=>typeof v==='string'&&/^\d{2}:\d{2}$/.test(v)).length;if(operation!=='add_minutes'&&clocks&&clocks!==values.length)throw new Error('同日钟点与完整日期时间不能混用。');
  let result:number|string|boolean;
  if(operation==='add_minutes'){if(unit!=='minutes')throw new Error('add_minutes 的输入单位必须是 minutes；不能把小时直接当分钟。');if(values.length!==2||typeof values[1]!=='number'||!Number.isFinite(values[1]))throw new Error('需要开始时间和分钟数。');const end=time(values[0])+values[1]*60000;if(clocks){if(!Number.isInteger(values[1]))throw new Error('同日HH:mm模式只接受整数分钟；小数分钟须使用完整日期时间。');if(end<0||end>=86400000)throw new Error('跨日须提供完整日期与时区。');result=`${String(Math.floor(end/3600000)).padStart(2,'0')}:${String(Math.floor(end/60000)%60).padStart(2,'0')}`;}else result=new Date(end).toISOString();}
  else if(operation==='minutes_between'){if(values.length!==2)throw new Error('需要起止两个时间。');result=(time(values[1])-time(values[0]))/60000;if(clocks&&result<0)throw new Error('跨日须提供完整日期与时区。');}
  else if(operation==='interval_overlap'){if(values.length!==4)throw new Error('需要两个时间段的起止时间。');const [a,b,c,d]=values.map(time);if(a>b||c>d)throw new Error('时间段起点不能晚于终点。');result=a<=d&&c<=b;}
  else {if(values.length!==2||values.some(v=>typeof v!=='number'||!Number.isFinite(v)))throw new Error('数值运算需要两个有限数字，必须先确认单位相同。');const [a,b]=values as number[];if(operation==='compare')result=a<b?'less':a>b?'greater':'equal';else if(operation==='add')result=a+b;else if(operation==='subtract')result=a-b;else throw new Error('不支持的运算。');if(typeof result==='number'&&!Number.isFinite(result))throw new Error('计算结果超出范围。');}
  return {operation,values,unit:operation==='add_minutes'?'time':operation==='minutes_between'?'minutes':unit,result,evidence:input.evidence};
}
