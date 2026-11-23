-- The rules the app starts with (spec §11, from the penningmeester's export of 2019–2026); he can change them.
INSERT INTO mollie_rules (id, keyword, account_code, sort) VALUES
  ('dagkaart', 'dagkaart', '8012', 1),
  ('dagticket', 'dagticket', '8012', 2),
  ('lidm', 'lidm', '8000', 3),
  ('lidmaatschap', 'lidmaatschap', '8000', 4),
  ('verl', 'verl', '8000', 5),
  ('reserver', 'reserver', '8010', 6),
  ('verhuur', 'verhuur', '8010', 7);
