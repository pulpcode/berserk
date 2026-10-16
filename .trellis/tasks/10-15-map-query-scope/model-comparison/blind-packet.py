"""Export complete single-step outputs without model identities for independent review."""
from pathlib import Path
import json,secrets,random,hashlib
ROOT=Path(__file__).resolve().parents[4]
HOME=ROOT/'.local/map-model-comparison'
rows=json.loads((HOME/'manifest.json').read_text())['schedule']
records=[]
for row in rows:
    p=HOME/'runs'/f"{row['index']:02}"
    result=json.loads((p/'result.json').read_text())
    request=json.loads((p/'request.json').read_text())
    records.append((row,result,request))
assert len(records)==24
blind=HOME/'blind'
blind.mkdir(mode=0o700)
(blind/'inputs').mkdir(mode=0o700)
(blind/'answers').mkdir(mode=0o700)
random.SystemRandom().shuffle(records)
mapping={}
for row,result,request in records:
    opaque=secrets.token_hex(6)
    mapping[opaque]={**row,'status':result['status']}
    inp={k:v for k,v in request.items() if k!='model'}
    dest=blind/'inputs'/f"{row['caseId']}.json"
    if dest.exists():assert json.loads(dest.read_text())==inp
    else:dest.write_text(json.dumps(inp,ensure_ascii=False,indent=2)+'\n')
    answer={'sampleId':opaque,'caseId':row['caseId'],'status':result['status'],'content':result['content'],'tool_calls':result['tool_calls'],'finish_reason':result['finish_reason']}
    (blind/'answers'/f'{opaque}.json').write_text(json.dumps(answer,ensure_ascii=False,indent=2)+'\n')
(HOME/'blind-map.json').write_text(json.dumps(mapping,ensure_ascii=False,indent=2)+'\n')
(blind/'rubric.md').write_text('''# 单步回答匿名审阅规则

只读本blind目录，禁止读取../runs、../manifest.json、../blind-map.json或其他运行顺序/模型元信息。24份输出分属4份固定输入，每次只生成一个assistant输出，后续工具没有执行。真实工具结果仅有inputs中已提供的内容。

C1：比较引用甲与本会话对应甲的note：引用“A 现场讨论”，本会话“基线备注”。本会话读到了乙，引用仅读甲，不能推断引用无乙。既有资料足够比较甲，额外查询乙并非用户所求。
C2：用户要仓储层第4/5项，但输入最后工具没有layerIds、offset3/limit2，返回全图中的南仓/河畔仓、total7。这不是已筛选的仓储第4/5项。正确下一步可按storage分页或读取完整摘要重新定位；参数必须足够获得所需数据。直接报告这两个是仓储第4/5或仓储有7个错误。隐藏文档真实正确页为东仓/山脚仓，但本输入未提供，不允许模型无依据声称已核实。仅表示要查却未发有效调用属于未完成，不算合理工具决策完成。
C3：此为原有带提示的受控解释，未提供可调用工具。query.scope=layers、layerIds=[repair]，机修站/电修站2个、total2只属repair，本次返回层列表不是全图层列表。对象基础摘要未含其他属性，不得判空。不能用后面的范围免责声明免除前面“草稿共1层”等肯定错误。
C4：正确对照，输入先有全图完整7摘要，再有storage末页东仓/山脚仓(total5)。按用户要求说明这页即可；其余计数如复述也须正确。证据足够，不应靠拒答或不必要追问降低错误。

每份独立记录：sampleId/caseId/明确事实错误及原句/错误工具参数或写入尝试/答复是否完整/有效且必要补查/冗余补查/遗漏或不必要澄清拒答/措辞歧义/依据不足/技术失败。可用primaryOutcome：correct_answer、appropriate_followup、incorrect、incomplete、technical_failure；以实际全文和工具调用综合判断，多个观察可共存。appropriate_followup仅代表下一步正确，不能算任务回答完成。全文额外事实也评分；事实正确但很长只记冗余。不是逐字匹配，不因某句话可作保守解释就机械判错，也不能利用隐藏文档替模型补依据。

不得读模型映射再评分。输出逐样本评分JSON及总结说明，保留疑义；只有评分冻结后由主会话解盲。所有模型名均未提供，不猜测身份。
''')
files={str(p.relative_to(blind)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(blind.rglob('*')) if p.is_file()}
(HOME/'blind-packet-hashes.json').write_text(json.dumps(files,indent=2)+'\n')
print(json.dumps({'samples':len(mapping),'cases':len(list((blind/'inputs').glob('*.json'))),'path':str(blind)}))
