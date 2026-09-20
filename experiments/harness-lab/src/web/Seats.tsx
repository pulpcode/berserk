import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AppInfo } from '../contracts/index';
import { api, ApiContext, createApiClient } from './api';

export interface TestSeat { id: string; name: string }
export interface SeatView { active: boolean; seatId?: string; seats: TestSeat[]; switchSeat: (id: string) => void }

/** Keep visited seats mounted: their streams, next-message drafts and late replies keep their owner. */
export function Seats({ children }: { children: (view: SeatView) => ReactNode }) {
  const [info, setInfo] = useState<AppInfo>();
  const [selected, setSelected] = useState('');
  const [visited, setVisited] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let current = true;
    api<AppInfo>('/api/info').then(value => {
      if (!current) return;
      let saved = ''; try { saved = sessionStorage.getItem('axon.test-seat') || ''; } catch { /* In-memory selector remains usable. */ }
      const seat = value.testSeats?.find(item => item.id === saved)?.id || value.defaultSeatId || value.testSeats?.[0]?.id || '';
      setInfo(value); setSelected(seat); setVisited([seat]); setError('');
    }).catch((reason: unknown) => { if (current) setError(reason instanceof Error ? reason.message : '无法读取服务信息。'); });
    return () => { current = false; };
  }, [reload]);
  const clients = useMemo(() => new Map((info?.testSeats || [{ id: '', name: '' }]).map(seat => [seat.id, createApiClient(seat.id || undefined)])), [info]);
  if (!info) return <main className="bootstrap-message" role="status">{error || '正在连接工作台…'}{error && <button onClick={() => setReload(value => value + 1)}>重新连接</button>}</main>;
  const switchSeat = (id: string) => {
    if (!clients.has(id)) return;
    setSelected(id); setVisited(previous => previous.includes(id) ? previous : [...previous, id]);
    try { sessionStorage.setItem('axon.test-seat', id); } catch { /* Keep selection in memory. */ }
  };
  return visited.map(id => <div key={id} hidden={selected !== id} inert={selected !== id || undefined} data-seat={id || 'single'}><ApiContext.Provider value={clients.get(id)!}>{children({ active: selected === id, seatId: id || undefined, seats: info.testSeats || [], switchSeat })}</ApiContext.Provider></div>);
}
