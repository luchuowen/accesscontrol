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
  wantKeys?: Record<string, string>; // memberNo → last desired fingerprint written
  lastEventTo: string | null;
  pendingAcks: { memberNo: number; version: number; ok: boolean; error?: string; axtraxUserId?: number }[];
}

export class Journal {
  data: JournalData;
  constructor(private readonly file: string) {
    this.data = Journal.empty();
    if (!existsSync(file)) return;
    try {
      const raw = readFileSync(file, 'utf8').replace(/^﻿/, '');
      this.data = { ...Journal.empty(), ...(JSON.parse(raw) as JournalData) };
    } catch {
      // A damaged journal must never stop the doors being managed: keep it for inspection, resync from the cloud.
      renameSync(file, `${file}.corrupt-${Date.now()}`);
    }
  }
  static empty(): JournalData {
    return {
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
    writeFileSync(`${this.file}.${process.pid}.tmp`, JSON.stringify(this.data));
    renameSync(`${this.file}.${process.pid}.tmp`, this.file); // atomic replace
  }
}
