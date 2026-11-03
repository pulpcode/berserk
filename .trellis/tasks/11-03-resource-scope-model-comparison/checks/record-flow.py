import json,sys
from pathlib import Path
p=Path(sys.argv[1]); rationale=sys.argv[2]; assert rationale.strip()
r=json.loads((p/'result.json').read_text());assert r['status']=='trajectory_recorded';assert not r['stateChanged'];assert json.loads((p/'state-before.json').read_text())==json.loads((p/'state-after.json').read_text());assert r['usage']['unknown']==0 and r['usage']['reservedInput']==0 and r['usage']['reservedOutput']==0
d={'reviewer':'comparison_runner_resume','rationale':rationale+' 前后业务状态一致、用量已结算；此处仅流程放行，业务评分待独立双审。','continuationAllowed':True,'trajectoryAuditable':True,'isolatedEffectsVerified':True}
with (p/'continuation-review.json').open('x') as f:json.dump(d,f,ensure_ascii=False,indent=2)
print(json.dumps(r,ensure_ascii=False))
