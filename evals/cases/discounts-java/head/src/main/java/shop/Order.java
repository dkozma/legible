package shop;

public record Order(long itemsCents, long shippingCents, boolean loyaltyMember) {
    public long totalCents() {
        return itemsCents + shippingCents;
    }
}
