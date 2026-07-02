-- Allow deleting a bean that is part of a blend (cascade to blend_components)
ALTER TABLE blend_components
  DROP CONSTRAINT IF EXISTS blend_components_bean_id_fkey;

ALTER TABLE blend_components
  ADD CONSTRAINT blend_components_bean_id_fkey
  FOREIGN KEY (bean_id) REFERENCES beans(id) ON DELETE CASCADE;
