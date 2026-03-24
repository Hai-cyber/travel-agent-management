# CODE CONVENTIONS

## Language Policy

### Code
- All code MUST be written in English
- Includes:
  - variable names
  - function names
  - file names
  - API routes
  - database fields

### Comments
- Comments SHOULD be in Vietnamese
- Purpose:
  - explain business logic
  - explain domain meaning
  - help non-technical stakeholders understand

---

## Example

```ts
// Tính toán ngày đến và ngày rời dựa trên start_date và số đêm
export function recomputeSchedule(tour: Tour, destinations: Destination[]) {
  let currentDate = tour.start_date;

  return destinations.map((d) => {
    const arrival = currentDate;

    // departure = arrival + nights
    const departure = addDays(arrival, d.nights);

    currentDate = departure;

    return {
      ...d,
      arrival_date: arrival,
      departure_date: departure,
    };
  });
}