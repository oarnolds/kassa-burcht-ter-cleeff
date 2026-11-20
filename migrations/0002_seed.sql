-- Start assortment: the 22 products of the iZettle export of 20 November 2026.

INSERT INTO categories (id, name, color, sort) VALUES
  ('ijs', 'IJs', 'rose', 1),
  ('koud', 'Koude dranken', 'blue', 2),
  ('warm', 'Warme dranken', 'brown', 3),
  ('snacks', 'Snacks', 'yellow', 4),
  ('entree', 'Entree', 'green', 5),
  ('statiegeld', 'Statiegeld', 'grey', 6);

INSERT INTO products (id, name, price_cents, category_id, sort, quantity_pad, track_stock, updated_at) VALUES
  ('aardbeitje', 'Aardbeitje', 110, 'ijs', 1, 0, 1, '2026-11-20T00:00:00.000Z'),
  ('appeltje-peer', 'Appeltje peer', 110, 'ijs', 2, 0, 1, '2026-11-20T00:00:00.000Z'),
  ('bosfruit', 'Bosfruit', 170, 'ijs', 3, 0, 1, '2026-11-20T00:00:00.000Z'),
  ('citroen-limoen', 'Citroën limoen', 170, 'ijs', 4, 0, 1, '2026-11-20T00:00:00.000Z'),
  ('mango-passie', 'Mango passie', 170, 'ijs', 5, 0, 1, '2026-11-20T00:00:00.000Z'),
  ('choco-brownie', 'Choco brownie', 210, 'ijs', 6, 0, 1, '2026-11-20T00:00:00.000Z'),
  ('strawberry-cheesecake', 'Strawberry cheesecake', 210, 'ijs', 7, 0, 1, '2026-11-20T00:00:00.000Z'),
  ('vanille-karamel', 'Vanille karamel', 210, 'ijs', 8, 0, 1, '2026-11-20T00:00:00.000Z'),
  ('passie-cheesecake', 'Passie cheesecake', 270, 'ijs', 9, 0, 1, '2026-11-20T00:00:00.000Z'),
  ('vanilla-cookie-dough', 'Vanilla Cookie Dough', 270, 'ijs', 10, 0, 1, '2026-11-20T00:00:00.000Z'),
  ('limonade', 'Limonade', 65, 'koud', 11, 0, 0, '2026-11-20T00:00:00.000Z'),
  ('appelsap', 'Appelsap', 110, 'koud', 12, 0, 0, '2026-11-20T00:00:00.000Z'),
  ('chocomel', 'Chocomel', 110, 'koud', 13, 0, 0, '2026-11-20T00:00:00.000Z'),
  ('spa', 'Spa Rood/Blauwe', 165, 'koud', 14, 0, 0, '2026-11-20T00:00:00.000Z'),
  ('blikje-fris', 'Blikje fris', 175, 'koud', 15, 0, 0, '2026-11-20T00:00:00.000Z'),
  ('koffie', 'Koffie', 140, 'warm', 16, 0, 0, '2026-11-20T00:00:00.000Z'),
  ('thee', 'Thee', 140, 'warm', 17, 0, 0, '2026-11-20T00:00:00.000Z'),
  ('liga', 'Liga', 60, 'snacks', 18, 0, 0, '2026-11-20T00:00:00.000Z'),
  ('chips', 'Chips', 70, 'snacks', 19, 0, 0, '2026-11-20T00:00:00.000Z'),
  ('stroopwafel', 'Stroopwafel', 130, 'snacks', 20, 0, 0, '2026-11-20T00:00:00.000Z'),
  ('entreegeld', 'Entreegeld', 60, 'entree', 21, 0, 0, '2026-11-20T00:00:00.000Z'),
  ('statiegeld', 'Statiegeld', 15, 'statiegeld', 22, 1, 0, '2026-11-20T00:00:00.000Z');
