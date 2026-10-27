/** Offline manifest generation only; never dispatches model requests. */
import {writeFileSync} from 'node:fs';
import {cases,schedule,materials,expectedFor,analyticTruth} from './cases.js';
import {newLayers,sourceScene} from './data.js';
import {mapFixtures} from '../../../../experiments/harness-lab/scripts/mock-context/map-fixtures.js';
const scene=(id:string)=>sourceScene(mapFixtures('map-fixture','2026-10-26'),'map-fixture','2026-10-26',id);
const freeze={schemaVersion:1,syntheticDay:'2026-10-26',evaluatorsOnly:true,truthMethod:'Independent sphere formulas and exact frozen facts',numericTruth:analyticTruth(),cases:cases.map(c=>({...c,...(c.historical?{historicalMaterial:materials.find(m=>m.id===c.id)}:{draftLayers:newLayers(c.id),sourceScene:scene(c.id),expected:expectedFor(c.id,{sourceBefore:{instanceId:'map-fixture',objects:scene(c.id).objects,reports:scene(c.id).reports,actions:[]}})} )}))};
writeFileSync(new URL('./cases.json',import.meta.url),JSON.stringify(freeze,null,2)+'\n');writeFileSync(new URL('./schedule.json',import.meta.url),JSON.stringify(schedule,null,2)+'\n');console.info(JSON.stringify({cases:cases.length,slots:schedule.length,paidRequests:0}));
