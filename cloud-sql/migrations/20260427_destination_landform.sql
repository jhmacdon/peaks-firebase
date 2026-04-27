-- Add broad natural landform support for destination-worthy terrain features
-- such as crater rims, ridges, saddles, cols, cirques, and basins.
ALTER TYPE destination_feature ADD VALUE IF NOT EXISTS 'landform';
