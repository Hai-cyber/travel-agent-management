#!/bin/bash

BASE="http://127.0.0.1:8787"

run_test() {
  GROUP=$1
  PAYLOAD=$2
  ENDPOINT=$3

  echo ""
  echo "==============================================="
  echo "=== Testing $GROUP ==="
  echo "==============================================="

  echo "1) Creating $GROUP"
  CREATE=$(curl -s -X POST $BASE/api/stops/1/$ENDPOINT \
    -H "Content-Type: application/json" \
    -H "X-Tenant-ID: ten-demo-001" \
    -d "$PAYLOAD")

  echo "$CREATE"

  ITEM_ID=$(echo $CREATE | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
  echo "Created $GROUP ID: $ITEM_ID"
  echo ""

  echo "2) Fetching $GROUP with tasks"
  LIST=$(curl -s $BASE/api/stops/1/$ENDPOINT \
    -H "X-Tenant-ID: ten-demo-001")
  echo "$LIST"
  echo ""

  echo "3) Extracting first task ID"
  TASK_ID=$(echo $LIST | sed -n 's/.*"tasks":

\[\{"id":"\([^"]*\)".*/\1/p')
  echo "Task ID: $TASK_ID"
  echo ""

  echo "4) Marking task as done"
  UPDATE=$(curl -s -X PATCH $BASE/api/tasks/$TASK_ID \
    -H "Content-Type: application/json" \
    -d '{"status":"done"}')

  echo "$UPDATE"
  echo ""

  echo "5) Fetching $GROUP again to verify task updated"
  FINAL=$(curl -s $BASE/api/stops/1/$ENDPOINT \
    -H "X-Tenant-ID: ten-demo-001")
  echo "$FINAL"
  echo ""

  echo "=== $GROUP TEST COMPLETE ==="
  echo ""
}

# 1. Accommodations
run_test "Accommodations" \
'{"hotel_name":"Test Hotel","person_in_charge":"Anna","address":"123 Street"}' \
"accommodations"

# 2. Meals
run_test "Meals" \
'{"meal_type":"Lunch","restaurant_name":"Pho 24","person_in_charge":"Anna","address":"123 Hanoi"}' \
"meals"

# 3. Guides
run_test "Guides" \
'{"guide_name":"Mr. Tuan","person_in_charge":"Anna","address":"123 Hanoi"}' \
"guides"

# 4. Local Transports
run_test "Local Transports" \
'{"mode":"Car","supplier":"Local Driver Co","address":"123 Hanoi","person_in_charge":"Anna"}' \
"local-transports"

# 5. Intercity Legs
run_test "Intercity Legs" \
'{"mode":"Train","supplier":"Vietnam Railways","address":"Hanoi Station","person_in_charge":"Anna","depart_point":"Hanoi","arrive_point":"Ninh Binh"}' \
"intercity-legs"

echo ""
echo "==============================================="
echo "=== ALL SERVICE GROUP TESTS COMPLETE ==="
echo "==============================================="
