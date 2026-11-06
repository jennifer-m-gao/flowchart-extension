def load(x):
    try:
        x = x * 2
        return x
    finally:
        print("cleanup")


load(21)
