-- The lab's KES 10 test price was grouped into the Gym service by 0014 and showed as a second "Gym" day pass.
-- It becomes its own service, "Test (KES 10)", so the desk never confuses it with the real gym day pass.
DO $$
DECLARE p record; v_id uuid;
BEGIN
  FOR p IN SELECT id, tenant_id, zone_keys FROM products WHERE name LIKE 'Test · %' LOOP
    INSERT INTO services (tenant_id, name, zone_keys) VALUES (p.tenant_id, 'Test (KES 10)', p.zone_keys) RETURNING id INTO v_id;
    UPDATE products SET service_id = v_id, name = 'Test (KES 10) · 1 day' WHERE id = p.id;
  END LOOP;
END $$;
