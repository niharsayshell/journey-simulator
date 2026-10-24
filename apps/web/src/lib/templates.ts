import type { ScenarioDefinitionInput } from "@js/shared";

/** Example journey for the bundled Demo Shop (http://localhost:4100). */
export function demoShopCheckout(origin = "http://localhost:4100"): { name: string; description: string; definition: ScenarioDefinitionInput } {
  return {
    name: "Demo Shop — browse and checkout",
    description: "Opens the shop, adds a product to the cart and completes the sandbox checkout.",
    definition: {
      startUrl: `${origin}/`,
      settings: { minSessionDurationMs: 0, maxDurationMs: 120000 },
      steps: [
        { id: "home", type: "NAVIGATE", url: "/", label: "Open home page" },
        { id: "hero", type: "ASSERT_VISIBLE", target: { strategy: "role", value: "heading", name: "Welcome to Demo Shop" } },
        { id: "scroll", type: "SCROLL", deltaY: 1200, steps: 4, label: "Scroll through featured collections" },
        { id: "read", type: "WAIT", durationMs: 500, randomMaxMs: 1500, label: "Pause to read" },
        { id: "shop", type: "CLICK", target: { strategy: "role", value: "link", name: "Shop now" } },
        { id: "on-products", type: "ASSERT_URL", expected: "/products", match: "pathEquals" },
        { id: "product", type: "CLICK", target: { strategy: "role", value: "link", name: "View Nimbus Headphones" } },
        { id: "qty", type: "SELECT", target: { strategy: "label", value: "Quantity" }, option: "2" },
        { id: "add", type: "CLICK", target: { strategy: "role", value: "button", name: "Add to cart" } },
        { id: "added", type: "ASSERT_TEXT", target: { strategy: "testId", value: "cart-count" }, expected: "2", match: "equals" },
        { id: "checkout", type: "NAVIGATE", url: "/checkout" },
        { id: "name", type: "TYPE", target: { strategy: "label", value: "Full name" }, text: "Ada Tester" },
        { id: "email", type: "TYPE", target: { strategy: "label", value: "Email" }, text: "ada.tester@example.com" },
        { id: "address", type: "TYPE", target: { strategy: "label", value: "Address" }, text: "1 QA Street" },
        { id: "shipping", type: "SELECT", target: { strategy: "label", value: "Shipping method" }, option: "express" },
        { id: "place", type: "CLICK", target: { strategy: "role", value: "button", name: "Place order" } },
        { id: "thanks", type: "ASSERT_TEXT", target: { strategy: "testId", value: "confirmation" }, expected: "is confirmed" },
        { id: "final", type: "SCREENSHOT", fullPage: true, label: "Capture confirmation" },
      ],
    },
  };
}
