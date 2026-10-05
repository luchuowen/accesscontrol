import { onboardingChecklist } from '@lango/server';
import {
  Building2,
  CalendarDays,
  CheckCircle2,
  Circle,
  Globe2,
  Handshake,
  Hash,
  Mail,
  MessageCircle,
  MessageSquare,
} from 'lucide-react';
import Link from 'next/link';
import { channelState } from '@/lib/comms-data';
import { date } from '@/lib/format';
import type { Session } from '@/lib/session';
import { db } from '@/server/db';
import { Group, Pill, Row, SectionHead } from './bits';

const BY = { navac: 'NAVAC', installer: 'Installer', club: '' } as const;

/** Settings › Club profile: details, setup progress and the ways members can be reached. */
export async function ClubTab({ s }: { s: Session }) {
  const [[t], checklist, ch] = await Promise.all([
    db()<{ name: string; slug: string; timezone: string; created_at: Date; partner: string | null }[]>`
      select t.name, t.slug, t.timezone, t.created_at, p.name as partner
      from tenants t left join partners p on p.id = t.partner_id where t.id = ${s.tid}`,
    onboardingChecklist(db(), s.tid),
    channelState(s.tid),
  ]);
  const by = t?.partner ?? 'NAVAC';
  const done = checklist.filter((i) => i.done).length;
  return (
    <>
      <SectionHead
        icon={Building2}
        title="Club profile"
        sub={`Set up by ${by}. Ask them to change the name or code.`}
      />
      <Group title="Details">
        <Row icon={Building2} label="Club name">
          {t?.name}
        </Row>
        <Row icon={Hash} label="Club code" hint="Members enter it as their member code to sign in">
          <span className="font-mono">{t?.slug}</span>
        </Row>
        <Row icon={Globe2} label="Time zone">
          {t?.timezone}
        </Row>
        <Row icon={Handshake} label="Partner">
          {by}
        </Row>
        <Row icon={CalendarDays} label="On Lango since">
          {t ? date(t.created_at) : ''}
        </Row>
      </Group>

      <Group
        title="Setup"
        action={
          <span className="flex items-center gap-2 text-[12px] font-semibold text-ink-500">
            <span className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-200">
              <i
                className="block h-full rounded-full bg-emerald-500"
                style={{ width: `${(done / checklist.length) * 100}%` }}
              />
            </span>
            {done}/{checklist.length}
          </span>
        }
      >
        {checklist.map((i) => {
          const body = (
            <>
              {i.done ? (
                <CheckCircle2 size={17} className="shrink-0 text-emerald-600" />
              ) : (
                <Circle size={17} className="shrink-0 text-ink-300" />
              )}
              <span className="min-w-0 flex-1">
                <span className={`block text-[13.5px] ${i.done ? 'text-ink-500' : 'text-ink-900'}`}>{i.label}</span>
              </span>
              {!i.done && i.by !== 'club' && <Pill ok={null}>{BY[i.by]}</Pill>}
              {!i.done && i.by === 'club' && (
                <span className="text-[12.5px] font-semibold text-emerald-700">Do it →</span>
              )}
            </>
          );
          return !i.done && i.by === 'club' ? (
            <Link key={i.key} href={i.href} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
              {body}
            </Link>
          ) : (
            <div key={i.key} className="flex items-center gap-3 px-4 py-3">
              {body}
            </div>
          );
        })}
      </Group>

      <Group title="Ways to reach members">
        <Row icon={MessageSquare} label="SMS" hint={ch.sms.on ? undefined : ch.sms.why}>
          <Pill ok={ch.sms.on}>{ch.sms.on ? 'On' : 'Off'}</Pill>
        </Row>
        <Row icon={MessageCircle} label="WhatsApp" hint={ch.whatsapp.number}>
          <Pill ok={ch.whatsapp.on ? true : null}>{ch.whatsapp.on ? 'Connected' : 'Not connected'}</Pill>
        </Row>
        <Row
          icon={Mail}
          label="Email"
          hint={ch.email.on && ch.email.address ? `Replies to ${ch.email.address}` : undefined}
        >
          <Pill ok={ch.email.on ? true : null}>{ch.email.on ? 'Connected' : 'Not connected'}</Pill>
        </Row>
      </Group>
    </>
  );
}
