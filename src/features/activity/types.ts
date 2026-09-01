export interface ActivityPeriod {
  text: string;
  updatedAt?: string | null;
}

export interface ActivityDay {
  date: string;
  morning: ActivityPeriod;
  afternoon: ActivityPeriod;
  evening: ActivityPeriod;
}

export interface SaveActivityRequest {
  date: string;
  morning: string;
  afternoon: string;
  evening: string;
}
