package shop;

public final class Discounts {
    private Discounts() {}

    static int percentFor(Order order) {
        int percent = order.itemsCents() > 25_000 ? 15 : order.itemsCents() > 10_000 ? 10 : 0;
        return order.loyaltyMember() ? percent + 5 : percent;
    }

    public static long discountCents(Order order) {
        return order.totalCents() * percentFor(order) / 100;
    }
}
