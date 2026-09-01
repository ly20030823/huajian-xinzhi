import { invoke } from "@tauri-apps/api/core";
import type { ActivityDay, SaveActivityRequest } from "./types";

export function getActivityDay(date: string): Promise<ActivityDay> {
  return invoke("activity_get", { date });
}

export function saveActivityDay(request: SaveActivityRequest): Promise<ActivityDay> {
  return invoke("activity_save", { request });
}

export function listActivityMonth(year: number, month: number): Promise<ActivityDay[]> {
  return invoke("activity_month", { year, month });
}

export function getActivityMonthReport(year: number, month: number): Promise<string> {
  return invoke("activity_month_report", { year, month });
}
