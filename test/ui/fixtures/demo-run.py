def classify(scores):
    results = []
    for s in scores:
        if s < 0:
            continue
        elif s > 100:
            break
        if s >= 50:
            results.append("pass")
        else:
            results.append("fail")
    else:
        print("all scores read")
    return results


def load(path):
    try:
        f = open(path)
        data = f.read()
        if not data:
            return None
    except OSError as e:
        print("error", e)
        raise
    finally:
        print("cleanup")
    return data


class Cart:
    def __init__(self):
        self.items = []

    def add_item(self, item, qty):
        while qty > 0:
            self.items.append(item)
            qty -= 1
        return len(self.items)


def main():
    scores = [5, -1, 70, 101, 40]
    print(classify(scores))
    print(classify([60, 10]))
    print(classify([-5]))
    cart = Cart()
    cart.add_item("apple", 3)
    load("no-such-file.txt")


main()
