-- Add viewpoint and waterfall destination features for vistas and hydrological points of interest.
ALTER TYPE destination_feature ADD VALUE IF NOT EXISTS 'viewpoint';
ALTER TYPE destination_feature ADD VALUE IF NOT EXISTS 'waterfall';
