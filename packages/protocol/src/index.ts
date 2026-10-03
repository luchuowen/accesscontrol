import { z } from 'zod';

/** Bridge ⇄ cloud protocol v1 (docs/BLUEPRINT.md §8). Local times are naive ISO in the site timezone. */
export const LocalTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/);

export const Credential = z.object({
  siteCode: z.number().int().min(0).max(65535),
  cardCode: z.number().int().positive(),
  cardType: z.number().int().min(0).default(1), // AxTraxNG reports 0 for some card formats
});

export const Segment = z.object({ from: LocalTime, until: LocalTime, zones: z.array(z.string().min(1)).min(1) });

/** Desired AxTraxNG state for one member at one site. Idempotent: applying it twice is a no-op. */
export const AccessState = z.object({
  memberNo: z.number().int().positive().max(2147483647),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  mobile: z.string().optional(),
  version: z.number().int().nonnegative(),
  credentials: z.array(Credential).max(16),
  segments: z.array(Segment),
});
export type AccessState = z.infer<typeof AccessState>;

/** Zone → AxTraxNG reader IDs at this site. */
export const ZoneMap = z.record(z.string(), z.array(z.number().int().positive()));
export type ZoneMap = z.infer<typeof ZoneMap>;

export const SyncResponse = z.object({
  cursor: z.number().int().nonnegative(),
  zones: ZoneMap,
  timezone: z.string().default('Africa/Nairobi'),
  states: z.array(AccessState),
  /** The club asked to (re)read its AxTraxNG setup; the bridge answers with POST /api/bridge/inventory. */
  inventoryRequested: z.boolean().optional(),
});
export type SyncResponse = z.infer<typeof SyncResponse>;

export const AckResult = z.object({
  memberNo: z.number().int(),
  version: z.number().int(),
  ok: z.boolean(),
  error: z.string().optional(),
  axtraxUserId: z.number().int().optional(),
});
export const AckRequest = z.object({ results: z.array(AckResult) });
export type AckResult = z.infer<typeof AckResult>;

export const AccessEvent = z.object({
  id: z.number().int(),
  at: LocalTime,
  readerId: z.number().int(),
  doorId: z.number().int(),
  userNo: z.number().int().nullable(),
  cardCode: z.number().int(),
  siteCode: z.number().int(),
  granted: z.boolean(),
});
export const EventsRequest = z.object({ events: z.array(AccessEvent) });
export type AccessEvent = z.infer<typeof AccessEvent>;

export const DriftRequest = z.object({
  drift: z.array(z.object({ memberNo: z.number().int(), changes: z.array(z.string()) })),
});

/**
 * What the site's AxTraxNG already holds, sent by the Site Bridge so a club can be onboarded from its existing
 * setup: doors/readers to map to zones, and existing users + cards to import. Never includes biometrics.
 */
export const InventoryRequest = z.object({
  axtraxVersion: z.string().max(40).optional(),
  readers: z
    .array(z.object({ id: z.number().int(), name: z.string().max(120), door: z.string().max(120).optional() }))
    .max(2000),
  groups: z
    .array(z.object({ id: z.number().int(), name: z.string().max(120), readers: z.array(z.number().int()) }))
    .max(2000),
  users: z
    .array(
      z.object({
        number: z.number().int(),
        firstName: z.string().max(120),
        lastName: z.string().max(120),
        mobile: z.string().max(40).optional(),
        validFrom: LocalTime.nullable(),
        validUntil: LocalTime.nullable(),
        datesEnforced: z.boolean(),
        groupId: z.number().int().nullable(),
        cards: z
          .array(
            z.object({
              siteCode: z.number().int(),
              cardCode: z.number().int(),
              cardType: z.number().int(),
              active: z.boolean(),
            }),
          )
          .max(16),
      }),
    )
    .max(50000),
});
export type InventoryRequest = z.infer<typeof InventoryRequest>;
