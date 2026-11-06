import functools


def logged(fn):
    @functools.wraps(fn)
    def wrapper(*args):
        return fn(*args)
    return wrapper


@logged
def double(n):
    return n * 2


class Cart:
    def __init__(self):
        self.items = []

    def add_item(self, item):
        self.items.append(item)


def outer():
    def inner(y):
        return y + 1
    return inner(1)


square = lambda v: v * v
cart = Cart()
cart.add_item(double(3))
total = outer() + square(2)
doubled = [x * 2 for x in range(3)]
print(total, doubled, cart.items)
