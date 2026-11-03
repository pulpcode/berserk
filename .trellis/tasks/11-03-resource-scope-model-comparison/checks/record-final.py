"""Record an already semantically reviewed final; never classifies responses."""
import json,sys
from pathlib import Path
p=Path(sys.argv[1]);rationale=sys.argv[2];assert rationale.strip()
x=json.loads(p.read_text());assert not x['evidence'].get('interaction')
d={'evidenceHash':x['evidenceHash'],'kind':'final','reviewer':'comparison_runner_resume','rationale':rationale}
with Path(x['decisionPath']).open('x') as f:json.dump(d,f,ensure_ascii=False,indent=2)
