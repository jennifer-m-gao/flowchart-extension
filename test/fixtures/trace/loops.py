def classify(scores):
    labels = []
    for s in scores:
        if s < 0:
            continue
        elif s > 100:
            break
        else:
            labels.append("pass" if s >= 50 else "fail")
    return labels


print(classify([5, -1, 70, 101, 40]))
print(classify([60, -2]))
print("a", 1)
