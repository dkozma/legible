package shop;

public record Order(long itemsCents, long shippingCents) {
    public long totalCents() {
        return itemsCents + shippingCents;
    }
}
