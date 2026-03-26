// Tests for CHK‑R09: stop-based service model API
const request = require('supertest');
const app = require('../src/index');

describe('Service Items API', () => {
  const stopId = 'demo-stop-001';
  const group = 'accommodations';
  let itemId;

  it('should create an accommodation', async () => {
    const res = await request(app)
      .post(`/api/stops/${stopId}/${group}`)
      .send({ hotel_name: 'Demo Hotel', check_in: '2026-03-25', check_out: '2026-03-26' });
    expect(res.body.ok).toBe(true);
    expect(res.body.item).toHaveProperty('hotel_name', 'Demo Hotel');
    itemId = res.body.item.id;
  });

  it('should fetch accommodations', async () => {
    const res = await request(app)
      .get(`/api/stops/${stopId}/${group}`);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it('should update accommodation', async () => {
    const res = await request(app)
      .patch(`/api/${group}/${itemId}`)
      .send({ notes: 'Updated note' });
    expect(res.body.ok).toBe(true);
    expect(res.body.item).toHaveProperty('notes', 'Updated note');
  });

  // Repeat for other groups
  ['meals', 'guides', 'local-transports', 'intercity-legs'].forEach(g => {
    it(`should create and fetch ${g}`, async () => {
      const createRes = await request(app)
        .post(`/api/stops/${stopId}/${g}`)
        .send({ test_field: 'test' });
      expect(createRes.body.ok).toBe(true);
      const fetchRes = await request(app)
        .get(`/api/stops/${stopId}/${g}`);
      expect(fetchRes.body.ok).toBe(true);
    });
  });
});
