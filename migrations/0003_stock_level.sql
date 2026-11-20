-- The stock of a product is kept on the product itself, next to the movements that explain it.
-- Adding the movements up on every read costs a walk through all of them, and the iPad asks for the
-- catalog twice a minute: within weeks that would use up the rows the free plan lets us read in a day.
ALTER TABLE products ADD COLUMN stock INTEGER NOT NULL DEFAULT 0;

UPDATE products SET stock = COALESCE((SELECT SUM(delta) FROM stock_movements WHERE product_id = products.id), 0);

-- The database keeps the two in step itself, so that no piece of code can forget to.
CREATE TRIGGER stock_movement_added AFTER INSERT ON stock_movements
BEGIN
  UPDATE products SET stock = stock + NEW.delta WHERE id = NEW.product_id;
END;

CREATE TRIGGER stock_movement_removed AFTER DELETE ON stock_movements
BEGIN
  UPDATE products SET stock = stock - OLD.delta WHERE id = OLD.product_id;
END;

CREATE TRIGGER stock_movement_changed AFTER UPDATE OF product_id, delta ON stock_movements
BEGIN
  UPDATE products SET stock = stock - OLD.delta WHERE id = OLD.product_id;
  UPDATE products SET stock = stock + NEW.delta WHERE id = NEW.product_id;
END;

-- A reversal and a delivery find their movements by the sale or the order they belong to.
CREATE INDEX stock_movements_by_ref ON stock_movements(ref_id);
