/**
 * Role-based access control helpers.
 *
 * Role hierarchy (highest → lowest):
 *   owner    (4) — full access including billing and account management
 *   manager  (3) — all operations and configuration, cannot touch billing/subscription
 *   staff    (2) — operational access: bookings, tasks, reservations, calendar
 *   provider (1) — own assigned tasks only
 */

export const ROLE_RANK = {
  owner:    4,
  manager:  3,
  staff:    2,
  provider: 1,
};

/**
 * Returns true if `role` meets or exceeds the `minRole` rank.
 * Unknown roles are treated as rank 0 (denied).
 *
 * @param {string} role     - The actor's current role (from session)
 * @param {string} minRole  - Minimum required role ('manager', 'staff', etc.)
 */
export function hasMinRole(role, minRole) {
  return (ROLE_RANK[role] ?? 0) >= (ROLE_RANK[minRole] ?? 0);
}
