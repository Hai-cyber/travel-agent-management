-- CHK-406 follow-up
-- Editable class labels (text names) for traveler-facing class choices.

ALTER TABLE booking_settings ADD COLUMN class_labels_json TEXT;
