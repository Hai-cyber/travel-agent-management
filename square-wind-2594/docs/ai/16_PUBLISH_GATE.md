# PUBLISH GATE

## Purpose

Ensure legal, billing, and domain requirements are met before going live.

## Requirements

- Domain verified
- Payment method added
- Terms accepted
- Commission agreement accepted

## Behavior

If not satisfied:
- disable publish
- show checklist

## Preview Mode

- always available
- no real booking

## Runtime baseline

- tenant checklist state is persisted separately from domain verification
- publish gate is enforced when a tour moves to `on_sale`