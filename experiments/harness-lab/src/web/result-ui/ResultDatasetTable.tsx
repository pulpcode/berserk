import { useState } from 'react';
import type { ResultDatasetV1 } from '../../contracts/result-dataset';
import { columnLabel, displayDatasetCell } from './dataset-chart';

const pageSize = 20;

export function ResultDatasetTable({ columns, rows, title = '结果表格' }: Pick<ResultDatasetV1, 'columns' | 'rows'> & { title?: string }) {
  const [requestedPage, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(requestedPage, pageCount - 1);
  const visible = rows.slice(page * pageSize, (page + 1) * pageSize);

  return <div className="chat-result-ui-table">
    <div className="chat-result-ui-table-scroll" role="region" aria-label={`${title}，可横向滚动`} tabIndex={0}>
      <table data-result-ui-dataset-table={title === '结果表格' ? '' : undefined}>
        <caption>{title}</caption>
        <thead><tr><th scope="col">行标识</th>{columns.map(column => <th key={column.id} scope="col">{columnLabel(column)}</th>)}</tr></thead>
        <tbody>
          {visible.map(row => <tr key={row.id}>
            <th scope="row">{row.id}</th>
            {columns.map(column => <td key={column.id} className={column.type === 'number' ? 'chat-result-ui-number' : undefined}>
              {displayDatasetCell(row.values[column.id])}
            </td>)}
          </tr>)}
          {!rows.length && <tr><td colSpan={columns.length + 1}>计算结果没有数据行。</td></tr>}
        </tbody>
      </table>
    </div>
    {pageCount > 1 && <nav className="chat-result-ui-pagination" aria-label={`${title}分页`}>
      <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>上一页</button>
      <span role="status">第 {page + 1} / {pageCount} 页，共 {rows.length} 行</span>
      <button type="button" disabled={page === pageCount - 1} onClick={() => setPage(page + 1)}>下一页</button>
    </nav>}
  </div>;
}
