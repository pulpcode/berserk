import type { NotificationTarget } from '../control-api.js';
import { scenarioControl } from './control.js';
import { scenarioQuery } from './query.js';
import { ScenarioStore } from './store.js';

export function createScenarioEngine(options:{databasePath?:string;targets:NotificationTarget[]}) {
  const store=new ScenarioStore(options.databasePath);
  return {query:scenarioQuery(store),control:scenarioControl(store,options.targets),handlesControl:(path:string)=>/^\/control\/(?:scenarios|instances|operations|scenario-actions)(?:\/|$)/.test(path),close:()=>store.close()};
}
