def step(n):
    a = n * 3
    b = a % 7
    if b > 3:
        a += b
    return a + b


total = 0
for i in range(1700):
    total += step(i)
print(total)
