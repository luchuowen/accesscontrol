-- Your account (3 Oct 2026): display name, profile photo and appearance, set by each person for themselves.
-- The photo is a small square JPEG (resized in the browser, at most ~60 KB), kept as a data URL.
ALTER TABLE staff_users ADD COLUMN avatar text CHECK (avatar IS NULL OR (avatar LIKE 'data:image/%' AND length(avatar) <= 90000));
ALTER TABLE staff_users ADD COLUMN theme text NOT NULL DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system'));

CREATE FUNCTION app_staff_profile(p_id uuid) RETURNS TABLE (name text, avatar text, theme text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.name, s.avatar, s.theme FROM staff_users s WHERE s.id = p_id AND s.active
$$;

-- Only ever called with the signed-in person's own id. A null photo keeps the current one; '' removes it.
CREATE FUNCTION app_staff_set_profile(p_id uuid, p_name text, p_theme text, p_avatar text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF length(trim(coalesce(p_name, ''))) < 2 THEN RAISE EXCEPTION 'name too short'; END IF;
  UPDATE staff_users SET name = left(trim(p_name), 80), theme = p_theme,
         avatar = CASE WHEN p_avatar IS NULL THEN avatar ELSE nullif(p_avatar, '') END
  WHERE id = p_id;
END $$;
