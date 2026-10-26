package shop;

public final class Discounts {
    private Discounts() {}

    public static long discountCents(Order order) {
        if (order.itemsCents() > 10_000) {
            return order.itemsCents() / 10;
        }
        return 0;
    }
}
