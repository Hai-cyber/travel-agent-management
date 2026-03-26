-- Luxury > Boutique > Standard
-- sort_order: Luxury=1, Boutique=2, Standard=3
UPDATE pricing_segments SET sort_order=1 WHERE id='segment-vip'      AND tenant_id='ten-demo-001';
UPDATE pricing_segments SET sort_order=2 WHERE id='segment-boutique' AND tenant_id='ten-demo-001';
UPDATE pricing_segments SET sort_order=3 WHERE id='segment-standard' AND tenant_id='ten-demo-001';

-- Swap prices: Luxury gets highest tier, Boutique gets mid tier
UPDATE tour_prices SET adult_shared_room_price=1250, adult_single_room_price=1490, child_shared_with_parents_price=750 WHERE id='price-hs-vip-b1';
UPDATE tour_prices SET adult_shared_room_price=1080, adult_single_room_price=1290, child_shared_with_parents_price=648 WHERE id='price-ls-vip-b1';
UPDATE tour_prices SET adult_shared_room_price=950,  adult_single_room_price=1150, child_shared_with_parents_price=570 WHERE id='price-hs-btq-b1';
UPDATE tour_prices SET adult_shared_room_price=820,  adult_single_room_price=990,  child_shared_with_parents_price=490 WHERE id='price-ls-btq-b1';
