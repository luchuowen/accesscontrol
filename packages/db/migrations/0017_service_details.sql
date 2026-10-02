-- Services page (design A, 2 Oct 2026): each service has a group and an icon (from the ready list of common services)
-- and says who can buy it: members (renewals, M-Pesa prompts), walk-ins (day passes at the desk) or both.
ALTER TABLE services ADD COLUMN category text;
ALTER TABLE services ADD COLUMN icon text;
ALTER TABLE services ADD COLUMN sold_to text NOT NULL DEFAULT 'both' CHECK (sold_to IN ('members', 'walkins', 'both'));

UPDATE services SET
  category = CASE
    WHEN name ILIKE '%all%inclusive%' OR name ILIKE '%bundle%' THEN 'Facilities'
    WHEN name ILIKE '%gym%' OR name ILIKE '%fitness%' OR name ILIKE '%class%' THEN 'Fitness'
    WHEN name ILIKE '%swim%' OR name ILIKE '%pool%' THEN 'Aquatics'
    WHEN name ILIKE '%sauna%' OR name ILIKE '%steam%' OR name ILIKE '%spa%' THEN 'Wellness'
    WHEN name ILIKE '%court%' OR name ILIKE '%squash%' OR name ILIKE '%tennis%' THEN 'Courts & sport'
    ELSE 'Other' END,
  icon = CASE
    WHEN name ILIKE '%all%inclusive%' OR name ILIKE '%bundle%' THEN 'package'
    WHEN name ILIKE '%gym%' OR name ILIKE '%fitness%' THEN 'dumbbell'
    WHEN name ILIKE '%swim%' OR name ILIKE '%pool%' THEN 'waves'
    WHEN name ILIKE '%sauna%' THEN 'flame'
    WHEN name ILIKE '%steam%' THEN 'cloud'
    WHEN name ILIKE '%spa%' THEN 'sparkles'
    ELSE 'layers' END;
