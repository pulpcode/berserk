from pathlib import Path
import json
r=Path('/home/ubuntu/axon-r3-release-4315-20261116-retry');source=json.loads((r/'source-package.json').read_text());deployment=json.loads((r/'deployment.json').read_text())
for name in ['release.json','deployment.json','r3-verification.json']:
 p=r/name;v=json.loads(p.read_text());v.update({'sourceCommit':'4016843','sourceArchiveSha256':source['sha256'],'r3UserAcceptance':'pending'})
 if name=='release.json':v.update({'release':'Axon R3 skills 4315','commit':'4016843','previousRelease':'/home/ubuntu/axon-r2-release-4315-20261114','updatedAt':deployment['updatedAt']})
 if name=='r3-verification.json':v.update({'skillCatalogBuiltinCount':4,'skillManagementDenied':403,'unauthenticatedSkillsDenied':401,'brandAssetsVerified':True,'modelsInvoked':0})
 p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
print('Release and verification metadata updated; credentials untouched.')
