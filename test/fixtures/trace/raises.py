def check(value):
    if value < 0:
        raise ValueError("bad")
    return value


check(-1)
