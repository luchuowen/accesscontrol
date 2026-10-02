/**
 * The ready list of common services that need door access and are paid for (Owen, 2 Oct 2026). Adding a service is
 * picking it here and typing the prices, so a club rarely starts from a blank form. Lengths are suggestions only;
 * prices are always the club's own.
 */
export type CatalogItem = { name: string; icon: string; sub: string; lengths: string };

export const CATALOG: [string, CatalogItem[]][] = [
  [
    'Fitness',
    [
      {
        name: 'Gym',
        icon: 'dumbbell',
        sub: 'Gym floor and weights',
        lengths: 'Day pass · 1 month · 3 months · 1 year',
      },
      { name: 'Group classes', icon: 'music', sub: 'Studio: aerobics, yoga, spinning', lengths: '1 hour · 1 month' },
      { name: 'Personal training', icon: 'user', sub: 'Gym access with a trainer', lengths: '1 hour · 1 month' },
      { name: 'Climbing wall', icon: 'mountain', sub: 'Bouldering and climbing', lengths: 'Day pass · 1 month' },
    ],
  ],
  [
    'Aquatics',
    [
      { name: 'Swimming pool', icon: 'waves', sub: 'Pool and poolside', lengths: 'Day pass · 1 month · 1 year' },
      { name: 'Kids’ swimming', icon: 'waves', sub: 'Children’s pool or lessons', lengths: 'Day pass · 1 month' },
    ],
  ],
  [
    'Wellness',
    [
      { name: 'Sauna', icon: 'flame', sub: 'Sauna room', lengths: 'Day pass · 1 month' },
      { name: 'Steam room', icon: 'cloud', sub: 'Steam room', lengths: 'Day pass · 1 month' },
      { name: 'Spa', icon: 'sparkles', sub: 'Spa and treatment rooms', lengths: '2 hours · Day pass' },
      { name: 'Changing rooms & showers', icon: 'droplet', sub: 'For people passing through', lengths: 'Day pass' },
    ],
  ],
  [
    'Courts & sport',
    [
      { name: 'Squash court', icon: 'target', sub: 'Book by the hour', lengths: '1 hour · 1 month' },
      { name: 'Tennis court', icon: 'volleyball', sub: 'Book by the hour', lengths: '1 hour · 1 month' },
      { name: 'Padel court', icon: 'target', sub: 'Book by the hour', lengths: '1 hour' },
      { name: 'Basketball court', icon: 'volleyball', sub: 'Court hire', lengths: '1 hour · Day' },
      { name: 'Golf driving range', icon: 'flag', sub: 'Range and bays', lengths: '1 hour · Day pass · 1 month' },
    ],
  ],
  [
    'Work & study',
    [
      { name: 'Hot desk', icon: 'laptop', sub: 'Co-working, any free desk', lengths: 'Day pass · 1 week · 1 month' },
      { name: 'Dedicated desk', icon: 'laptop', sub: 'Own desk in the shared space', lengths: '1 month · 3 months' },
      { name: 'Meeting room', icon: 'presentation', sub: 'Book by the hour', lengths: '1 hour · Day' },
      { name: 'Study room', icon: 'book', sub: 'Quiet study space or library', lengths: 'Day pass · 1 month' },
    ],
  ],
  ['Family', [{ name: 'Kids’ play area', icon: 'baby', sub: 'Play area', lengths: '2 hours · Day pass · 1 month' }]],
  [
    'Facilities',
    [
      { name: 'Locker', icon: 'lock', sub: 'A personal locker', lengths: '1 month · 1 year' },
      { name: 'Parking', icon: 'car', sub: 'Car park gate', lengths: 'Day · 1 month' },
      { name: 'Lounge', icon: 'coffee', sub: 'Members’ lounge or clubhouse', lengths: 'Day pass · 1 month' },
      { name: 'All-inclusive', icon: 'package', sub: 'Everything in one price', lengths: '1 month · 1 year' },
    ],
  ],
];

export const CATEGORIES = [...CATALOG.map(([c]) => c), 'Other'];
export const CATALOG_ITEMS = CATALOG.flatMap(([cat, items]) => items.map((i) => ({ ...i, cat })));
export const SOLD_TO = [
  ['both', 'Members & walk-ins'],
  ['members', 'Members'],
  ['walkins', 'Walk-ins'],
] as const;
export type SoldTo = (typeof SOLD_TO)[number][0];
