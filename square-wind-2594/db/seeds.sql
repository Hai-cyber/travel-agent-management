-- Seed Data (insert-only)
-- CHK-102
-- Luu y: du lieu seed co timestamp co dinh de dam bao tinh tai lap

-- =========================

-- Tenant & user
INSERT INTO tenants (id, slug, name, created_at) VALUES
('ten-0001-aaaa-bbbb-cccc-000000000001', 'demo-agency', 'Demo Travel Agency', strftime('%s','2026-03-21T00:00:00Z')*1000);

INSERT INTO users (id, email, hash, created_at) VALUES
('usr-0001-aaaa-bbbb-cccc-000000000001', 'owner@demoagency.vn', NULL, strftime('%s','2026-03-21T00:00:00Z')*1000);

INSERT INTO memberships (user_id, tenant_id, role) VALUES
('usr-0001-aaaa-bbbb-cccc-000000000001', 'ten-0001-aaaa-bbbb-cccc-000000000001', 'owner');

-- Tour mẫu: "Vietnam Essentials 6N5Đ"
INSERT INTO tours (id, tenant_id, title, lang, start_date, duration_text, status, created_at) VALUES
('tour-0001-aaaa-bbbb-cccc-000000000001', 'ten-0001-aaaa-bbbb-cccc-000000000001',
 'Vietnam Essentials (HCMC–HN–SP) 6N5Đ', 'vi', strftime('%s','2026-04-15T08:00:00Z')*1000,
 '6N5Đ', 'on_sale', strftime('%s','2026-03-21T00:00:00Z')*1000);

-- Destinations với nights & arrival/departure pre-tính (ví dụ)
-- Ngày bắt đầu 2026-04-15 → Sài Gòn 2 đêm; Hà Nội 2 đêm; Sapa 1 đêm
INSERT INTO destinations (id, tenant_id, tour_id, name, position, nights, arrival_date, departure_date, created_at) VALUES
('dst-0001-sgn', 'ten-0001-aaaa-bbbb-cccc-000000000001', 'tour-0001-aaaa-bbbb-cccc-000000000001',
 'Sài Gòn', 1, 2, strftime('%s','2026-04-15T10:00:00Z')*1000, strftime('%s','2026-04-17T09:00:00Z')*1000, strftime('%s','2026-03-21T00:00:00Z')*1000),
('dst-0002-han', 'ten-0001-aaaa-bbbb-cccc-000000000001', 'tour-0001-aaaa-bbbb-cccc-000000000001',
 'Hà Nội', 2, 2, strftime('%s','2026-04-17T13:00:00Z')*1000, strftime('%s','2026-04-19T08:00:00Z')*1000, strftime('%s','2026-03-21T00:00:00Z')*1000),
('dst-0003-spa', 'ten-0001-aaaa-bbbb-cccc-000000000001', 'tour-0001-aaaa-bbbb-cccc-000000000001',
 'Sa Pa',   3, 1, strftime('%s','2026-04-19T13:30:00Z')*1000, strftime('%s','2026-04-20T08:00:00Z')*1000, strftime('%s','2026-03-21T00:00:00Z')*1000);

-- Destination texts (tùy chọn)
INSERT INTO destination_texts (id, tenant_id, destination_id, summary, details, notes, lang, updated_at) VALUES
('dtx-0001', 'ten-0001-aaaa-bbbb-cccc-000000000001', 'dst-0001-sgn',
 'Khám phá Sài Gòn nhộn nhịp, chợ Bến Thành, phố đi bộ Nguyễn Huệ.',
 'Gợi ý: Dinh Thống Nhất, Nhà thờ Đức Bà, Bưu điện, Bảo tàng Chứng tích; ẩm thực đường phố.',
 NULL, 'vi', strftime('%s','2026-03-21T00:00:00Z')*1000),
('dtx-0002', 'ten-0001-aaaa-bbbb-cccc-000000000001', 'dst-0002-han',
 'Thủ đô nghìn năm, phố cổ, hồ Gươm, 36 phố phường.',
 'Gợi ý: Văn Miếu, Hoàng Thành, ẩm thực phở/bún chả; cafe phố cổ, chợ Đồng Xuân.',
 NULL, 'vi', strftime('%s','2026-03-21T00:00:00Z')*1000);

-- Accommodation (Sài Gòn, 2 đêm)
INSERT INTO dest_accommodations
(id, tenant_id, destination_id, hotel_name, contact_name, contact_phone, contact_email, check_in, check_out, room_type, guests, notes, status, position, created_at)
VALUES
('acc-0001', 'ten-0001-aaaa-bbbb-cccc-000000000001', 'dst-0001-sgn',
 'Hotel Ben Thanh Boutique', 'Ms. Linh', '+84-9xx-111-222', 'sales@benthanh-hotel.vn',
 strftime('%s','2026-04-15T14:00:00Z')*1000, strftime('%s','2026-04-17T12:00:00Z')*1000,
 'Deluxe Double', 2, 'Check-in 14:00; yêu cầu tầng cao', 'planned', 1, strftime('%s','2026-03-21T00:00:00Z')*1000);

-- Meals (Sài Gòn)
INSERT INTO dest_meals
(id, tenant_id, destination_id, meal_type, restaurant_name, contact_name, contact_phone, contact_email, meal_datetime, notes, status, position, created_at)
VALUES
('meal-0001', 'ten-0001-aaaa-bbbb-cccc-000000000001', 'dst-0001-sgn',
 'dinner', 'Nhà hàng Hoa Mai', 'Anh Thắng', '+84-9xx-333-444', 'booking@hoamai.vn',
 strftime('%s','2026-04-15T18:30:00Z')*1000, 'Bàn 6 người, set menu hải sản', 'planned', 1, strftime('%s','2026-03-21T00:00:00Z')*1000);

-- Guide (Hà Nội)
INSERT INTO dest_guides
(id, tenant_id, destination_id, guide_name, phone, email, languages, time_from, time_to, notes, status, position, created_at)
VALUES
('gui-0001', 'ten-0001-aaaa-bbbb-cccc-000000000001', 'dst-0002-han',
 'Anh Minh', '+84-9xx-555-666', 'minh.guide@example.com', 'vi,en',
 strftime('%s','2026-04-18T08:30:00Z')*1000, strftime('%s','2026-04-18T16:30:00Z')*1000,
 'City tour cổ; ưu tiên văn miếu', 'planned', 1, strftime('%s','2026-03-21T00:00:00Z')*1000);

-- Local transport (Hà Nội)
INSERT INTO dest_local_transports
(id, tenant_id, destination_id, mode, supplier, driver_name, phone, email, pickup_time, pickup_place, dropoff_place, notes, status, position, created_at)
VALUES
('loc-0001', 'ten-0001-aaaa-bbbb-cccc-000000000001', 'dst-0002-han',
 'van', 'Hanoi Shuttle', 'Anh Quân', '+84-9xx-777-888', 'ops@hnshuttle.vn',
 strftime('%s','2026-04-18T08:00:00Z')*1000, 'Khách sạn Old Quarter', 'Văn Miếu',
 'Xe 16 chỗ', 'planned', 1, strftime('%s','2026-03-21T00:00:00Z')*1000);

-- Intercity (Hà Nội → Sa Pa)
INSERT INTO dest_intercity_legs
(id, tenant_id, destination_id, mode, supplier, contact_name, phone, email, depart_time, depart_point, arrive_point, ticket_ref, notes, status, position, created_at)
VALUES
('leg-0001', 'ten-0001-aaaa-bbbb-cccc-000000000001', 'dst-0002-han',
 'train', 'Vietnam Rail', 'Ticket Desk', '+84-24-xxx-yyy', 'support@vr.vn',
 strftime('%s','2026-04-19T12:30:00Z')*1000, 'Ga Hà Nội', 'Lào Cai', 'SP3-AC',
 'Tàu đêm, khoang 4 giường', 'planned', 1, strftime('%s','2026-03-21T00:00:00Z')*1000);

-- Threads & messages (ví dụ: email đặt bàn)
INSERT INTO comm_threads (id, tenant_id, entity_type, entity_id) VALUES
('thr-0001', 'ten-0001-aaaa-bbbb-cccc-000000000001', 'meal', 'meal-0001');

INSERT INTO comm_messages
(id, tenant_id, thread_id, channel, direction, subject, body, to_addr, from_addr, created_by, created_at)
VALUES
('msg-0001', 'ten-0001-aaaa-bbbb-cccc-000000000001', 'thr-0001', 'email', 'outbound',
 'Đặt bàn 18:30 ngày 15/04', 'Xin xác nhận bàn 6 người, set hải sản.', 'booking@hoamai.vn', 'ops@demoagency.vn',
 'usr-0001-aaaa-bbbb-cccc-000000000001', strftime('%s','2026-03-21T00:00:00Z')*1000);

-- Pricing & policy
INSERT INTO tour_prices
(id, tenant_id, tour_id, season, pax_from, pax_to, adult_price, child_price, infant_price, single_supp, weekend_surcharge, currency, effective_from, effective_to)
VALUES
('pri-0001', 'ten-0001-aaaa-bbbb-cccc-000000000001', 'tour-0001-aaaa-bbbb-cccc-000000000001',
 'default', 2, 8, 11990000, 8990000, 0, 1200000, 300000, 'VND',
 strftime('%s','2026-03-01T00:00:00Z')*1000, strftime('%s','2026-12-31T23:59:59Z')*1000);

INSERT INTO tour_policies
(id, tenant_id, tour_id, deposit_pct, pay_deadline_days, cancel_terms_text)
VALUES
('pol-0001', 'ten-0001-aaaa-bbbb-cccc-000000000001', 'tour-0001-aaaa-bbbb-cccc-000000000001',
 0.3, 7, 'Huỷ trước 7 ngày: miễn phí; 3–6 ngày: 30%; <72h: 100%.');

-- Visual
INSERT INTO tour_visuals
(id, tenant_id, tour_id, intro_text, terms_text, faq_text, theme, primary_color, font, hero_url)
VALUES
('vis-0001', 'ten-0001-aaaa-bbbb-cccc-000000000001', 'tour-0001-aaaa-bbbb-cccc-000000000001',
 'Hành trình Việt Nam đặc sắc: Sài Gòn – Hà Nội – Sa Pa trong 6N5Đ.',
 'Giá đã bao gồm vé tham quan theo chương trình, xe đưa đón, HDV tiếng Việt.',
 'Hỏi: Có đón sân bay? Trả lời: Có, tuỳ khung giờ.', 'classic', '#0ea5e9', 'Inter', 'https://img.example/hero-vietnam.jpg');

INSERT INTO tour_media
(id, tenant_id, tour_id, url, caption, position, for_destination_id)
VALUES
('med-0001', 'ten-0001-aaaa-bbbb-cccc-000000000001', 'tour-0001-aaaa-bbbb-cccc-000000000001',
 'https://img.example/saigon.jpg', 'Sài Gòn năng động', 1, 'dst-0001-sgn');

-- Tasks (ví dụ khi booking sẽ tạo tự động; seed demo tạo sẵn 1 task)
INSERT INTO tasks
(id, tenant_id, booking_id, service_entity_type, service_entity_id, title, due_at, status, last_notice_at)
VALUES
('tsk-0001', 'ten-0001-aaaa-bbbb-cccc-000000000001', NULL, 'meal', 'meal-0001',
 'Xác nhận bàn ăn tối Sài Gòn 15/04', strftime('%s','2026-04-15T10:30:00Z')*1000, 'pending', NULL);
