import { useEffect, useState } from 'react';
import { CircleAlert } from 'lucide-react';

/** Polling keeps the last successful data; reconnect only repeats reads, never mutations. */
export function DirectoryStatus({ connectionError, taskError, activityError, retry }: { connectionError: boolean; taskError: boolean; activityError: boolean; retry: () => Promise<void> }) {
  const [persistent, setPersistent] = useState(false);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setPersistent(true), 5000);
    return () => clearTimeout(timer);
  }, []);
  const message = connectionError ? '暂时无法连接服务，正在重试。' : taskError && activityError ? '任务列表与对话动态暂时无法更新，正在重试。' : taskError ? '任务列表暂时无法更新，正在重试。' : '动态更新失败，正在重试。';
  return <div className="directory-status" role="status" aria-label="数据更新状态" aria-live="polite" aria-atomic="true">
    <CircleAlert size={16} aria-hidden="true" /><span>{message}已加载的内容会保留。</span>
    {persistent && <button type="button" disabled={retrying} onClick={() => {
      setRetrying(true);
      void retry().finally(() => setRetrying(false));
    }}>{retrying ? '正在重试…' : connectionError ? '重新连接' : '重新获取数据'}</button>}
  </div>;
}
