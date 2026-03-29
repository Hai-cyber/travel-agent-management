src = open('public/editor-bridge.js').read()
lines = src.split('\n')
depth = 0
for i, line in enumerate(lines, 1):
    for c in line:
        if c == '{': depth += 1
        elif c == '}': depth -= 1
print(f'Final depth: {depth}')
print(f'Total lines: {len(lines)}')

# Find last point where depth was zero before end
depth = 0
last_zero = 0
for i, line in enumerate(lines, 1):
    for c in line:
        if c == '{': depth += 1
        elif c == '}': depth -= 1
    if depth == 0:
        last_zero = i
print(f'Last line where depth=0: {last_zero}')
print(f'Content at last zero:')
print(lines[last_zero-1])
print('...next 5 lines:')
for l in lines[last_zero:last_zero+5]:
    print(l)
