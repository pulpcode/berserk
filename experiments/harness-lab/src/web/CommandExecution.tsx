import type { CommandExecution, VehicleExecutionState } from '../contracts/commands';
import type { ContextRef } from '../contracts/context';

const stateLabels: Record<VehicleExecutionState, string> = {
  waiting: '待出发', en_route: '途中', blocked: '受阻', arrived: '已到场', cancelled: '已取消',
};
const executionLabels: Record<CommandExecution['status'], string> = {
  accepted: '已受理', refused: '未受理', active: '执行中', completed: '本指令车辆已到场', cancelled: '行动已取消',
};
const actionLabels = { dispatch: '派遣', reroute: '调整路线', cancel: '取消行动' };
const sceneTime = (value?: string) => value ? value.slice(11, 19) : '—';

export function CommandExecutionDetails({ execution, label }: {
  execution: CommandExecution;
  label: (ref: ContextRef) => string;
}) {
  const status = execution.status === 'completed' && !execution.vehicles.every(vehicle => vehicle.state === 'arrived')
    ? '本指令行动已结束' : executionLabels[execution.status];
  return <section className="command-execution" aria-label="执行进展">
    <div className="director-section-heading">
      <h3>执行进展</h3>
      <span>{status} · {sceneTime(execution.businessNow)}</span>
    </div>
    {execution.reason && <p className={execution.status === 'refused' ? 'resource-error' : 'resource-help'}>{execution.reason}</p>}
    {execution.vehicles.length > 0 && <div className="execution-table-wrap" role="region" tabIndex={0} aria-label="逐车进展">
      <table className="execution-table">
        <thead><tr><th>车辆</th><th>状态</th><th>预计到场</th><th>到场时间</th></tr></thead>
        <tbody>{execution.vehicles.map(vehicle => <tr key={vehicle.vehicle.objectId}>
          <th scope="row">{label(vehicle.vehicle)}<small>{vehicle.position.map(value => value.toFixed(5)).join(', ')}</small></th>
          <td>{stateLabels[vehicle.state]}{vehicle.blockedReason && <small>{vehicle.blockedReason}</small>}</td>
          <td>{vehicle.state === 'cancelled' ? '—' : vehicle.state === 'blocked' ? '待核实' : sceneTime(vehicle.estimatedArrivalAt)}</td>
          <td>{sceneTime(vehicle.arrivedAt)}</td>
        </tr>)}</tbody>
      </table>
    </div>}
    {execution.history.length > 0 && <details className="execution-history">
      <summary>行动记录</summary>
      <ol>{execution.history.map(item => <li key={item.commandId}>
        <span>{sceneTime(item.businessTime)} · {actionLabels[item.action]}</span>
        <p>{item.vehicles.map(label).join('、')}{item.reason ? ` · ${item.reason}` : ''}</p>
      </li>)}</ol>
    </details>}
  </section>;
}
