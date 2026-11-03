import {isDeepStrictEqual} from 'node:util';
import type {SessionSnapshot} from '../../../../experiments/harness-lab/src/contracts/index.js';
import {criticalEffect,type Prepared,type MapState} from '../evaluation-v2/cases.js';
/** All diagnostic tasks leave source systems unchanged; preview/read tasks leave all map state unchanged. */
export function diagnosticEffect(caseId:string,p:Prepared,snapshot:SessionSnapshot,after:MapState,source:unknown){
 if(!isDeepStrictEqual(source,p.sourceBefore))return 'source_state_changed';
 return criticalEffect(p,snapshot,after,0,false)??(['R1','R2','S2'].includes(caseId)&&!isDeepStrictEqual(after,p.before)?'readonly_state_changed':undefined);
}
