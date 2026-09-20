import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PiLab } from '../../../src/pi/lab.js';
import { fakeRuntime, testConfig } from '../fake-runtime.js';
import type { WorkAction, WorkPrepareInput } from '../../../src/contracts/index.js';
const [dataDir, boundary] = process.argv.slice(2);
const config = testConfig(dataDir, { seatId: 'test-seat', testSeats: [{id:'test-seat',name:'A'},{id:'seat-b',name:'B'}] });
const fake = await fakeRuntime(config, (context, index) => {
  if (index === 0) return { tools: [{name:'work_item_prepare', arguments:{action:input}}] };
  if (index === 1) {
    const result = context.messages.findLast(message => message.role === 'toolResult' && message.toolName === 'work_item_prepare');
    if (!result || result.role !== 'toolResult' || result.isError) throw new Error('Preparation failed');
    return { tools: [{name:'work_item_commit', arguments:{operationId:(result.details as WorkAction).operationId}}] };
  }
  throw new Error('Must terminate before next model attempt');
});
const lab = await PiLab.create(config, fake.runtime); const workspace = lab.workspaces.get();
const input: WorkPrepareInput = {kind:'assign',taskSpaceId:workspace.taskSpaceId,payload:{workspaceId:workspace.id,assigneeSeatId:'seat-b',title:'中断边界',goal:'准确核对业务效果'}};
const commit = lab.collaboration!.commitAgent.bind(lab.collaboration!);
lab.collaboration!.commitAgent = async (...args) => {
  if (boundary === 'before') process.kill(process.pid, 'SIGKILL');
  const result = await commit(...args);
  process.kill(process.pid, 'SIGKILL');
  return result;
};
const session = await lab.createSession();
await lab.start(session.id, '分派给席位B').run(event => {
  if (event.type !== 'interaction.updated' || event.interaction.kind !== 'confirmation' || event.interaction.status !== 'pending') return;
  writeFileSync(join(dataDir,'probe.json'),JSON.stringify({sessionId:session.id,operationId:event.interaction.action.handoff!.operationId}));
  if (boundary === 'waiting') process.kill(process.pid, 'SIGKILL');
  lab.respondInteraction(session.id,event.interaction.interactionId,{requestId:event.requestId,kind:'confirmation',decision:'approve'});
});
throw new Error('Expected SIGKILL');
