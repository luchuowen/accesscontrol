import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AccessState, ZoneMap } from '@lango/protocol';

/** Durable local state so the bridge keeps enforcing schedules and Tamper Guard with no internet. */
export interface JournalData {
  cursor: number;
  timezone: string;
  zones: ZoneMap;
  states: Record<string, AccessState>; // by memberNo
  applied: Record<string, number>; // memberNo → applied version
  lastEventTo: string | null;
  pendingAcks: { memberNo: number; version: number; ok: boolean; error?: string; axtraxUserId?: number }[];
}

export class Journal {
  data: JournalData;
  constructor(private readonly file: string) {
    this.data = existsSync(file)
      ? (JSON.parse(readFileSync(file, 'utf8')) as JournalData)
      : {
          cursor: 0,
          timezone: 'Africa/Nairobi',
          zones: {},
          states: {},
          applied: {},
          lastEventTo: null,
          pendingAcks: [],
        };
  }
  save() {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.data));
    renameSync(`${this.file}.tmp`, this.file); // atomic replace
  }
}
