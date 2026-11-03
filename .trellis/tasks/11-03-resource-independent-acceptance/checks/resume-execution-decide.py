import json,sys
from pathlib import Path
entry,name,kind,rationale=sys.argv[1:5]
p=Path('/Users/lau/.codex/worktrees/agent-spatial-plotting/berserk/.local/resource-independent-acceptance/20261103-live-02')/entry/(name+'-review.json')
r=json.loads(p.read_text());d={'kind':kind,'reviewer':'Codex执行席','rationale':rationale,'evidenceHash':r['evidenceHash']}
if len(sys.argv)>5:d.update(json.loads(sys.argv[5]))
with p.with_name(name+'-decision.json').open('x') as f:json.dump(d,f,ensure_ascii=False,indent=2);f.write('\n')
print('Recorded reviewed decision for '+entry+'/'+name)
