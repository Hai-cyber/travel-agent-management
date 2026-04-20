-- CHK-R103: Add SEO/social fields to tours table
ALTER TABLE tours ADD COLUMN meta_title       TEXT;
ALTER TABLE tours ADD COLUMN meta_description TEXT;
ALTER TABLE tours ADD COLUMN og_image         TEXT;
