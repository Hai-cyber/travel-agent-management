-- Allow tenants to store custom pricing definitions (shown in public booking "Good to Know" section)
ALTER TABLE tenants ADD COLUMN pricing_notes_text TEXT;
