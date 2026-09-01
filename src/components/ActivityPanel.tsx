import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getActivityDay,
  getActivityMonthReport,
  listActivityMonth,
  saveActivityDay,
} from "../features/activity/api";
import type { ActivityDay } from "../features/activity/types";
import { getErrorMessage } from "../features/notes/api";

interface ActivityPanelProps {
  onClose: () => void;
  onCreateReport: (title: string, content: string) => Promise<void>;
}

const PERIODS = [
  ["morning", "上午", "例如：完成了什么、推进了什么……"],
  ["afternoon", "下午", "例如：会议、沟通、整理……"],
  ["evening", "晚上", "例如：复盘、收尾、明天准备……"],
] as const;

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromKey(value: string): Date {
  return new Date(`${value}T12:00:00`);
}

function emptyDay(date: string): ActivityDay {
  return {
    date,
    morning: { text: "" },
    afternoon: { text: "" },
    evening: { text: "" },
  };
}

function shiftDate(value: string, offset: number): string {
  const next = dateFromKey(value);
  next.setDate(next.getDate() + offset);
  return dateKey(next);
}

function monthName(year: number, month: number): string {
  return `${year} 年 ${month} 月`;
}

export function ActivityPanel({ onClose, onCreateReport }: ActivityPanelProps) {
  const today = useMemo(() => dateKey(new Date()), []);
  const [selectedDate, setSelectedDate] = useState(today);
  const [day, setDay] = useState<ActivityDay>(() => emptyDay(today));
  const [monthDays, setMonthDays] = useState<ActivityDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadSequenceRef = useRef(0);

  const selected = useMemo(() => dateFromKey(selectedDate), [selectedDate]);
  const year = selected.getFullYear();
  const month = selected.getMonth() + 1;
  const tomorrow = shiftDate(today, 1);
  const entryDates = useMemo(() => {
    return new Set(
      monthDays
        .filter((item) => item.morning.text || item.afternoon.text || item.evening.text)
        .map((item) => item.date),
    );
  }, [monthDays]);

  const refreshMonth = useCallback(async (nextYear: number, nextMonth: number) => {
    const entries = await listActivityMonth(nextYear, nextMonth);
    setMonthDays(entries);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const sequence = ++loadSequenceRef.current;
    setLoading(true);
    setNotice(null);
    void Promise.all([getActivityDay(selectedDate), listActivityMonth(year, month)])
      .then(([loaded, entries]) => {
        if (cancelled || sequence !== loadSequenceRef.current) return;
        setDay(loaded);
        setMonthDays(entries);
      })
      .catch((error) => {
        if (!cancelled) setNotice(getErrorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDate, year, month]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const persist = useCallback(
    async (next: ActivityDay) => {
      setSaving(true);
      try {
        const saved = await saveActivityDay({
          date: next.date,
          morning: next.morning.text,
          afternoon: next.afternoon.text,
          evening: next.evening.text,
        });
        if (selectedDate === saved.date) setDay(saved);
        await refreshMonth(dateFromKey(saved.date).getFullYear(), dateFromKey(saved.date).getMonth() + 1);
        setNotice("已自动保存，GitHub 同步时会一并上传");
      } catch (error) {
        setNotice(getErrorMessage(error));
      } finally {
        setSaving(false);
      }
    },
    [refreshMonth, selectedDate],
  );

  const updatePeriod = (period: "morning" | "afternoon" | "evening", text: string) => {
    const next = {
      ...day,
      [period]: { ...day[period], text },
    };
    setDay(next);
    setNotice(null);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => void persist(next), 650);
  };

  const selectDate = (date: string) => {
    setReport(null);
    setSelectedDate(date);
  };

  const changeMonth = (offset: number) => {
    const next = new Date(year, month - 1 + offset, 1, 12);
    selectDate(dateKey(next));
  };

  const generateReport = async () => {
    setReportBusy(true);
    try {
      const next = await getActivityMonthReport(year, month);
      setReport(next);
      if (!monthDays.some((item) => item.morning.text || item.afternoon.text || item.evening.text)) {
        setNotice("这个月还没有可整理的记录");
      }
    } catch (error) {
      setNotice(getErrorMessage(error));
    } finally {
      setReportBusy(false);
    }
  };

  const firstWeekday = (new Date(year, month - 1, 1, 12).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month, 0).getDate();
  const calendarCells = Array.from({ length: firstWeekday + daysInMonth }, (_, index) => {
    if (index < firstWeekday) return null;
    const dayNumber = index - firstWeekday + 1;
    const value = dateKey(new Date(year, month - 1, dayNumber, 12));
    return { dayNumber, value };
  });

  return (
    <aside className="relative isolate w-[360px] h-full min-h-0 shrink-0 overflow-clip border-l border-paper-deep/30 bg-cloud flex flex-col">
      <div className="flex items-center justify-between h-11 px-4 border-b border-paper-deep/25">
        <div>
          <h2 className="text-[13px] font-display font-medium text-ink-soft">工作足迹</h2>
          <p className="mt-0.5 text-[9px] text-ink-ghost">每天写三小段，月底就有月报</p>
        </div>
        <button type="button" onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:text-ink-soft hover:bg-paper-warm transition-colors cursor-pointer" title="关闭工作足迹" aria-label="关闭工作足迹">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 2l8 8M10 2l-8 8" /></svg>
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hidden px-4 py-4 space-y-4">
        <section className="rounded-xl border border-paper-deep/35 bg-paper/45 p-3">
          <div className="flex items-center justify-between gap-2">
            <button type="button" onClick={() => selectDate(shiftDate(selectedDate, -1))} className="w-7 h-7 rounded-lg text-ink-ghost hover:bg-paper-warm hover:text-bamboo">‹</button>
            <div className="text-center">
              <p className="text-[12px] font-medium text-ink-soft">{selectedDate}</p>
              <p className="mt-0.5 text-[9px] text-bamboo">{selectedDate === today ? "今天" : selectedDate === tomorrow ? "明日计划" : "补记 / 回顾"}</p>
            </div>
            <button type="button" onClick={() => selectDate(shiftDate(selectedDate, 1))} className="w-7 h-7 rounded-lg text-ink-ghost hover:bg-paper-warm hover:text-bamboo">›</button>
          </div>
          <button type="button" onClick={() => selectDate(today)} className="mt-2 w-full rounded-lg border border-paper-deep/30 py-1 text-[10px] text-ink-faint hover:border-bamboo/35 hover:text-bamboo">回到今天</button>
        </section>

        <section className="space-y-3">
          {PERIODS.map(([key, label, placeholder]) => (
            <label key={key} className="block rounded-xl border border-paper-deep/30 bg-paper/35 px-3 py-2.5 focus-within:border-bamboo/40 focus-within:bg-cloud transition-colors">
              <span className="block text-[10px] tracking-[0.12em] text-bamboo/75">{label}</span>
              <textarea
                value={day[key].text}
                onChange={(event) => updatePeriod(key, event.target.value)}
                disabled={loading}
                rows={3}
                placeholder={placeholder}
                className="mt-1.5 w-full resize-none bg-transparent text-[12px] leading-5 text-ink outline-none placeholder:text-ink-ghost/60 disabled:opacity-50"
              />
            </label>
          ))}
          <p className={`text-center text-[10px] ${notice?.includes("保存") ? "text-bamboo" : "text-ink-ghost"}`}>
            {saving ? "正在保存…" : notice ?? "内容会自动保存"}
          </p>
        </section>

        <section className="rounded-xl border border-paper-deep/35 bg-paper/35 p-3">
          <div className="flex items-center justify-between">
            <button type="button" onClick={() => changeMonth(-1)} className="w-6 h-6 rounded text-ink-ghost hover:bg-paper-warm">‹</button>
            <span className="text-[11px] text-ink-faint">{monthName(year, month)}</span>
            <button type="button" onClick={() => changeMonth(1)} className="w-6 h-6 rounded text-ink-ghost hover:bg-paper-warm">›</button>
          </div>
          <div className="mt-2 grid grid-cols-7 gap-y-1 text-center text-[9px] text-ink-ghost">
            {['一', '二', '三', '四', '五', '六', '日'].map((label) => <span key={label}>{label}</span>)}
            {calendarCells.map((cell, index) => cell ? (
              <button key={cell.value} type="button" onClick={() => selectDate(cell.value)} className={`relative mx-auto flex h-7 w-7 items-center justify-center rounded-full transition-colors ${cell.value === selectedDate ? "bg-bamboo text-white" : cell.value === today ? "text-bamboo bg-bamboo-mist/55" : "text-ink-faint hover:bg-paper-warm"}`}>
                {cell.dayNumber}
                {entryDates.has(cell.value) ? <span className={`absolute bottom-0.5 h-1 w-1 rounded-full ${cell.value === selectedDate ? "bg-white" : "bg-bamboo"}`} /> : null}
              </button>
            ) : <span key={`blank-${index}`} />)}
          </div>
        </section>

        <section className="rounded-xl border border-bamboo/25 bg-bamboo-mist/25 p-3">
          <div className="flex items-center justify-between gap-2">
            <div><p className="text-[11px] text-ink-soft">本月月报</p><p className="mt-0.5 text-[9px] text-ink-ghost">按日期和时段原样整理</p></div>
            <button type="button" onClick={() => void generateReport()} disabled={reportBusy} className="rounded-lg border border-bamboo/35 bg-cloud px-2.5 py-1.5 text-[10px] text-bamboo hover:bg-white disabled:opacity-50">{reportBusy ? "整理中…" : "生成月报"}</button>
          </div>
          {report ? (
            <div className="mt-3 space-y-2">
              <textarea readOnly value={report} rows={8} className="w-full resize-none rounded-lg border border-paper-deep/30 bg-cloud/80 p-2 text-[10px] leading-5 text-ink outline-none" />
              <div className="flex gap-2">
                <button type="button" onClick={() => void writeText(report).then(() => setNotice("月报已复制"), (error) => setNotice(getErrorMessage(error)))} className="flex-1 rounded-lg border border-paper-deep/35 py-1.5 text-[10px] text-ink-faint hover:text-bamboo hover:bg-cloud">复制 Markdown</button>
                <button type="button" onClick={() => void onCreateReport(`${year} 年 ${month} 月工作记录`, report).then(() => setNotice("月报已保存为笔记"), (error) => setNotice(getErrorMessage(error)))} className="flex-1 rounded-lg border border-paper-deep/35 py-1.5 text-[10px] text-ink-faint hover:text-bamboo hover:bg-cloud">保存为笔记</button>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </aside>
  );
}
