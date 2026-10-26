package shop;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class DiscountsTest {
    @Test
    void tenPercentOverAHundred() {
        assertEquals(1_500, Discounts.discountCents(new Order(15_000, 500)));
    }
}
