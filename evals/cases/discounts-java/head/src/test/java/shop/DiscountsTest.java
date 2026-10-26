package shop;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class DiscountsTest {
    @Test
    void tenPercentOverAHundred() {
        assertEquals(1_550, Discounts.discountCents(new Order(15_000, 500, false)));
    }

    @Test
    void fifteenPercentOverTwoFifty() {
        assertEquals(4_500, Discounts.discountCents(new Order(30_000, 0, false)));
    }

    @Test
    void loyaltyAddsFive() {
        assertEquals(3_000, Discounts.discountCents(new Order(20_000, 0, true)));
    }
}
