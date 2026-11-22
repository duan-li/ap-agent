-- Fence outstanding PID leases when upgrading to shared-volume ownership.
UPDATE runs SET lease_epoch=lease_epoch+1, lease_until=NULL WHERE lease_owner IS NOT NULL;
ALTER TABLE runs DROP COLUMN lease_owner;
ALTER TABLE runs ADD COLUMN lease_owner TEXT;
